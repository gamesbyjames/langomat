import React, { useEffect, useState } from "react";
import "./App.css";

// ──────────── ElevenLabs API configuration ──────────── //
let ELEVEN_LABS_API_KEY = localStorage.getItem("elevenLabsKey") || "";
if (!ELEVEN_LABS_API_KEY) {
  const entered = window.prompt(
    "Please enter your full ElevenLabs API key (it will be kept locally on this computer):"
  );
  if (entered && entered.trim().length > 0) {
    ELEVEN_LABS_API_KEY = entered.trim();
    localStorage.setItem("elevenLabsKey", ELEVEN_LABS_API_KEY);
  } else {
    console.warn("No ElevenLabs key provided – using browser TTS fallback.");
  }
}
const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1";
const VOICE_IDS = {
  "de-DE": "EXAVITQu4vr4xnSDxMaL",
  "tr-TR": "pNInz6obpgDQGcFmaJgB",
  "fr-FR": "ErXwobaYiN019PkySvjV",
  "po-PO": "ErXwobaYiN019PkySvjV",
  "it-IT": "ErXwobaYiN019PkySvjV",
  "en-US": "21m00Tcm4TlvDq8ikWAM",
  "es-ES": "ThT5KcBeYPX3keUQqHPh",
  "el-GR": "ThT5KcBeYPX3keUQqHPh",
};

// Human‑readable names for UI
const LANGUAGE_NAMES = {
  "de-DE": "German",
  "tr-TR": "Turkish",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "po-PO": "Portuguese",
  "it-IT": "Italian",
  "el-GR": "Greek",
};

// Languages that need romanisation hints
const HINT_LANGS = ["el-GR", "ru-RU", "ja-JP", "fa-IR"];

// ──────────── utility helpers ──────────── //
const shuffleArray = (array) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

async function loadPhrasesFromFile(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch error ${res.status}`);
    const text = await res.text();
    return parsePhrases(text);
  } catch (err) {
    console.error("loadPhrasesFromFile", err);
    return {
      Demo: [
        {
          words: ["Hola", "¿qué", "tal?"],
          translation: "Hello, how are you?",
          hint: null,
          audioCache: {},
        },
      ],
    };
  }
}

function parsePhrases(text) {
  const sections = {};
  let currentSection = null;
  text.split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    if (line.startsWith("#")) {
      currentSection = line.replace(/^#/, "").replace(/:\s*$/, "").trim();
      if (!sections[currentSection]) sections[currentSection] = [];
      return;
    }
    if (!currentSection) return;

    const barParts = line.split("|");
    if (barParts.length < 2) return;

    const first = barParts[0].trim();
    const rightSide = barParts.slice(1).join("|").trim();

    let translation = rightSide;
    let hint = null;
    const colonIdx = rightSide.indexOf(":");
    if (colonIdx !== -1) {
      translation = rightSide.slice(0, colonIdx).trim();
      hint = rightSide.slice(colonIdx + 1).trim();
    }

    sections[currentSection].push({
      words: first.split(/\s+/).filter(Boolean),
      translation,
      hint: hint || null,
      audioCache: {}, // Initialize audio cache for each phrase
    });
  });

  Object.keys(sections).forEach((s) => (sections[s] = shuffleArray(sections[s])));
  return sections;
}

// ──────────── TTS helpers ──────────── //
async function generateSpeech(text, language = "de-DE") {
  if (!ELEVEN_LABS_API_KEY) {
      console.warn("generateSpeech called without API key.");
      return null; // No key, can't generate
  }
  const voiceId = VOICE_IDS[language] || VOICE_IDS["de-DE"];
  try {
    const res = await fetch(`${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVEN_LABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) {
        // Log specific error from ElevenLabs if available
        let errorBody = "Unknown API error";
        try {
            const errorJson = await res.json();
            errorBody = errorJson.detail ? JSON.stringify(errorJson.detail) : res.statusText;
        } catch (parseErr) { /* Ignore if response isn't JSON */ }
        throw new Error(`TTS API Error ${res.status}: ${errorBody}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error("generateSpeech Error:", err);
    return null; // Indicate failure
  }
}

function fallbackSpeak(text, lang = "de-DE", rate = 0.8) {
  // Wrap the entire logic in a promise
  return new Promise((resolve, reject) => {
    const MAX_WAIT_TIME = 5000; // Increased wait time for mobile potentially slow voice loading/initiation

    // Check if SpeechSynthesis is available
    if (!window.speechSynthesis) {
       console.error("SpeechSynthesis API not supported by this browser.");
       return reject(new Error("SpeechSynthesis API not supported"));
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;

    let resolved = false; // Flag to prevent double resolution/rejection
    let timeoutId = null;

    const cleanup = () => {
      clearTimeout(timeoutId);
      // Ensure speech is stopped if promise resolves/rejects early or times out
      // Check if speaking before cancelling, as cancel() might throw error if not speaking
      if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
      }
      // Remove listeners to prevent memory leaks
      utterance.onend = null;
      utterance.onerror = null;
      utterance.onboundary = null; // Add other listeners if used
      // Remove the global listener only if it was set by this instance
      if (window.speechSynthesis.onvoiceschanged === trySpeakWithVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };

    utterance.onend = () => {
      if (resolved) return;
      console.log("Fallback TTS ended successfully.");
      resolved = true;
      cleanup();
      resolve();
    };

    utterance.onerror = (event) => {
      if (resolved) return;
      console.error("SpeechSynthesis Error:", event.error, event);
      resolved = true;
      cleanup();
      reject(new Error(`SpeechSynthesis Error: ${event.error || 'Unknown error'}`));
    };

    // Set a timeout to prevent hangs
    timeoutId = setTimeout(() => {
        if (resolved) return;
        console.warn(`Fallback TTS timed out after ${MAX_WAIT_TIME}ms.`);
        resolved = true;
        cleanup();
        // Reject on timeout
        reject(new Error(`SpeechSynthesis timed out after ${MAX_WAIT_TIME}ms`));
    }, MAX_WAIT_TIME);


    const trySpeakWithVoices = () => {
      // Ensure cleanup removes this specific listener if it was set
      window.speechSynthesis.onvoiceschanged = null;

      try {
        const voices = window.speechSynthesis.getVoices();
        console.log(`Available voices (${voices.length}):`, voices.map(v => `${v.name} (${v.lang}) [${v.localService ? 'Local':'Remote'}]`));

        const voice =
          voices.find((v) => v.lang === lang && v.localService) || // Prefer local matching voice
          voices.find((v) => v.lang === lang) || // Any matching voice
          voices.find((v) => v.lang.startsWith(lang.split("-")[0]) && v.localService) || // Prefer local matching language
          voices.find((v) => v.lang.startsWith(lang.split("-")[0])); // Any matching language

        if (voice) {
          utterance.voice = voice;
          console.log(`Using voice: ${voice.name} (${voice.lang})`);
        } else {
          console.warn(`No specific voice found for lang "${lang}". Using browser default.`);
        }

        // Crucial: Cancel any previous speech before starting new
        // Check synthesis state first
        if (window.speechSynthesis.pending || window.speechSynthesis.speaking) {
            console.log("Cancelling existing speech synthesis activity.");
            window.speechSynthesis.cancel();
        }

        // Need a tiny delay after cancel sometimes, especially on mobile
        setTimeout(() => {
            if (resolved) return; // Check if already resolved/rejected/timed out
            try {
                console.log("Calling window.speechSynthesis.speak()...");
                window.speechSynthesis.speak(utterance);
                console.log("Fallback TTS speak() called.");
            } catch (speakError) {
                // Catch potential immediate errors from .speak()
                if (resolved) return;
                 console.error("Error calling window.speechSynthesis.speak():", speakError);
                 resolved = true;
                 cleanup();
                 reject(speakError);
            }
        }, 50); // 50ms delay

      } catch (err) {
         if (resolved) return;
         console.error("Error during fallbackSpeak setup/execution:", err);
         resolved = true;
         cleanup();
         reject(err);
      }
    };

    // --- Voice Loading Logic ---
    const initialVoices = window.speechSynthesis.getVoices();
    if (initialVoices.length > 0) {
        console.log("Voices already available.");
        trySpeakWithVoices(); // Voices ready, proceed directly
    } else if (window.speechSynthesis.onvoiceschanged !== undefined) {
        console.log("Voices not loaded yet. Waiting for onvoiceschanged event...");
        // Set the event listener
        window.speechSynthesis.onvoiceschanged = trySpeakWithVoices;
        // Optional: Some browsers might need a nudge to trigger voice loading
        // (Use cautiously, might be unnecessary or cause issues)
        // window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
        // window.speechSynthesis.cancel();
    } else {
         console.warn("onvoiceschanged event not supported, attempting to speak without waiting.");
         // Fallback for browsers that don't support onvoiceschanged
         // May result in default voice being used if voices load later
         trySpeakWithVoices();
    }
  });
}


async function speak(text, language = "de-DE", cachedUrl = null) {
  let generatedUrl = null;
  try {
    // Use cache if available
    if (cachedUrl) {
       console.log("Using cached audio URL.");
       generatedUrl = cachedUrl;
    }
    // Try generating only if API key exists AND no cached URL was provided
    else if (ELEVEN_LABS_API_KEY) {
       console.log("Attempting ElevenLabs generation...");
       generatedUrl = await generateSpeech(text, language);
       if (!generatedUrl) {
           // generateSpeech failed but didn't throw (e.g., API error handled internally)
           console.log("ElevenLabs generation failed or returned null, attempting fallback.");
           throw new Error("ElevenLabs generation failed"); // Force fallback
       }
    }
    // No API key and no cache - must use fallback
    else {
       console.log("No API key and no cache, using browser fallback.");
       throw new Error("No API key provided, using fallback.");
    }

    // If we have a URL (cached or generated)
    if (generatedUrl) {
      console.log("Playing generated/cached audio URL:", generatedUrl);
      await new Promise((resolve, reject) => {
        const audio = new Audio(generatedUrl);
        // Add event listeners *before* calling play()
        audio.onended = () => {
            console.log("HTML Audio playback finished (onended).");
            resolve();
        };
        audio.onerror = (e) => {
           console.error("HTML Audio playback error:", e);
           // Try to provide more context if possible
           let errorMsg = "HTML Audio playback failed.";
           if (audio.error) {
               errorMsg += ` Code: ${audio.error.code}, Message: ${audio.error.message}`;
           }
           reject(new Error(errorMsg));
        }
        audio.onstalled = () => console.warn("Audio playback stalled.");
        audio.onsuspend = () => console.warn("Audio loading suspended.");

        // Attempt to play
        const playPromise = audio.play();
        if (playPromise !== undefined) {
           playPromise.then(() => {
               console.log("Audio playback started successfully.");
               // Resolve is handled by 'onended'
           }).catch((playError) => {
                console.error("Audio element .play() promise rejected:", playError);
                reject(new Error(`Audio playback initiation failed: ${playError.message}. User interaction might be required.`));
           });
        } else {
            // Older browsers might not return a promise from play()
            console.log("audio.play() did not return a promise. Relying on onended/onerror events.");
            // Reject after a timeout if neither onended nor onerror fires? Maybe not necessary.
        }
      });
      return generatedUrl; // Return the URL used
    }
    // This point should ideally not be reached if logic above is correct,
    // but acts as a safeguard to ensure fallback is attempted if url is missing.
    console.warn("Reached unexpected point in speak(), forcing fallback.");
    throw new Error("Generated URL was unexpectedly null");

  } catch (err) {
    // This catch block handles errors from generateSpeech, audio playback, OR the explicit throws above
    console.warn(`Speak function caught error, attempting fallback: ${err.message}`);
    try {
      console.log("Executing fallbackSpeak...");
      await fallbackSpeak(text, language);
      console.log("fallbackSpeak promise resolved.");
      // Fallback succeeded (or at least didn't reject), but we return null as no URL was generated/used
      return null;
    } catch (fallbackErr) {
      // Fallback itself failed
      console.error("Fallback TTS also failed:", fallbackErr);
      // Maybe notify the user more visibly?
      // alert(`Text-to-speech failed. Both API and browser fallback encountered issues: ${fallbackErr.message}`);
      // Still return null, indicating failure to produce playable audio URL.
      return null;
    }
  }
}


// ──────────── Components ──────────── //
const LoadingOverlay = ({ isLoading, message }) =>
  !isLoading ? null : (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 text-white z-50">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"></div>
      <p className="text-lg font-semibold">{message}</p>
    </div>
  );

function WordTile({ word, hidden, isCorrect, onClick }) {
  // Keep position state local to the tile, regenerated on reshuffle via key change
  const [pos] = useState({ top: Math.random() * 70 + 5, left: Math.random() * 70 + 5 });
  if (hidden) return null;
  return (
    <div
      style={{ top: `${pos.top}%`, left: `${pos.left}%` }}
      className={`word-tile ${isCorrect === true ? "correct" : isCorrect === false ? "incorrect" : ""}`}
      onClick={() => onClick(word)} // Pass the word itself
    >
      {word}
    </div>
  );
}

// ──────────── Main App ──────────── //
export default function App() {
  const [language, setLanguage] = useState("de-DE");
  const [sections, setSections] = useState({});
  const [currentSection, setCurrentSection] = useState(null);
  const [idx, setIdx] = useState(0);

  const [shuffled, setShuffled] = useState([]);
  const [shuffleVersion, setShuffleVersion] = useState(0); // Used in key for WordTile
  const [clicked, setClicked] = useState([]);
  const [wordStatus, setWordStatus] = useState({}); // Tracks correct/incorrect status for styling
  const [showWords, setShowWords] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const [loadingMsg, setLoadingMsg] = useState("Loading...");
  const [isLoading, setIsLoading] = useState(true);

  const phrases = currentSection ? sections[currentSection] || [] : [];
  // Ensure 'current' always has a defined structure, even if phrases[idx] is undefined temporarily
  const current = phrases[idx] || { words: [], translation: "Loading...", hint: null, audioCache: {} };
  const langNeedsHint = HINT_LANGS.some((l) => language.startsWith(l));

  // Load file whenever language changes
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setLoadingMsg(`Loading ${LANGUAGE_NAMES[language]} phrases...`); // More specific message
      // Clear previous state immediately
      setSections({});
      setCurrentSection(null);
      setIdx(0);

      const fileMap = {
        "de-DE": "german_phrases.txt",
        "tr-TR": "phrases.txt",
        "fr-FR": "french_phrases.txt",
        "es-ES": "spanish_phrases.txt",
        "po-PO": "portuguese_phrases.txt",
        "it-IT": "italian_phrases.txt",
        "el-GR": "greek_phrases.txt",
        // Add other language files here if needed
      };
      // Default to a known file if language isn't mapped, or handle error
      const fileName = fileMap[language] || "german_phrases.txt"; // Adjust default as needed
      console.log(`Fetching phrases from: ${process.env.PUBLIC_URL}/${fileName}`);
      const data = await loadPhrasesFromFile(`${process.env.PUBLIC_URL}/${fileName}`);
      setSections(data);
      // Don't automatically select a section, let user choose from Home
      // setCurrentSection(Object.keys(data)[0] || null); // Optionally select first section
      setIsLoading(false);
    })();
  }, [language]); // Dependency is correct

  // Reset UI state when phrase changes (index or section changes)
  useEffect(() => {
    // Only reset if we have a valid 'current' phrase with words
    if (current && current.words.length > 0) {
      console.log("Resetting UI for new phrase:", current.words.join(" "));
      setShuffled(shuffleArray(current.words));
      setShuffleVersion((v) => v + 1); // Force remount of WordTiles with new positions/state
      setClicked([]);
      setWordStatus({});
      setShowWords(false); // Hide words for the new phrase initially
      setShowHint(false);
      // Cancel any ongoing speech synthesis when phrase changes
       if (window.speechSynthesis && window.speechSynthesis.speaking) {
           console.log("Cancelling speech synthesis due to phrase change.");
           window.speechSynthesis.cancel();
           setIsSpeaking(false); // Ensure state reflects cancellation
       }
    }
     // Also reset if current section becomes null (going home)
     else if (!currentSection) {
        setClicked([]);
        setWordStatus({});
        setShowWords(false);
        setShowHint(false);
     }
  }, [idx, currentSection, current.words]); // Depend on current.words to trigger on actual data change

  // Word Tile Click Handler
  const handleWordClick = async (word) => {
    // Keep the initial guards
    if (!showWords || isSpeaking || isLoading) return;

    const expected = current.words[clicked.length];

    if (word === expected) {
      // Correct word clicked
      console.log(`Correct word clicked: ${word}`);
      setWordStatus((prev) => ({ ...prev, [word]: true })); // Mark as correct immediately
      const newArr = [...clicked, word];
      setClicked(newArr); // Update clicked array

      // Check if sentence is complete
      if (newArr.length === current.words.length) {
        setIsSpeaking(true); // Set speaking BEFORE the async call
        try {
          console.log("Sentence complete, attempting to speak...");
          // Use the current phrase object which contains its audioCache
          const phraseToSpeak = current.words.join(" ");
          const cachedAudio = current.audioCache.fullSentence;

          const spokenUrl = await speak(phraseToSpeak, language, cachedAudio);

          // If speak returned a new URL (meaning it generated one), cache it
          if (spokenUrl && !cachedAudio) {
             console.log("Caching generated audio URL for this phrase.");
             // MUTATE the cache within the current phrase object in the sections state
             // This is generally discouraged in React, but might be okay for non-critical cache data.
             // A more robust solution might involve updating the state immutably.
             const currentPhrase = sections[currentSection][idx];
             if (currentPhrase) {
                currentPhrase.audioCache.fullSentence = spokenUrl;
             }
          }
          console.log("Speak call finished in handleWordClick.");
        } catch (error) {
          // speak() function now has internal logging, but catch just in case
          console.error("Error during speak call in handleWordClick:", error);
          // Consider showing a user-facing message here
        } finally {
          // CRITICAL: Ensure isSpeaking is set to false regardless of success/failure
          console.log("Setting isSpeaking to false in handleWordClick finally block.");
          setIsSpeaking(false);
        }
      }
    } else {
      // Incorrect word clicked
      console.log(`Incorrect word clicked: ${word}. Expected: ${expected}`);
      setWordStatus((prev) => ({ ...prev, [word]: false })); // Mark as incorrect
      // Optional: Reset incorrect status after a short delay
      setTimeout(() => {
           setWordStatus((prev) => ({...prev, [word]: undefined })); // Reset status
      }, 800); // Reset after 800ms
    }
  };

  // Repeat Sentence Handler
  const repeatSentence = async () => {
    // Guard against repeating an incomplete sentence or while already speaking or loading
    if (clicked.length !== current.words.length || isSpeaking || isLoading) return;

    setIsSpeaking(true); // Set speaking BEFORE the async call
    try {
      console.log("Repeating sentence...");
      // Use the cached URL if available on the current phrase object
       const phraseToSpeak = current.words.join(" ");
       const cachedAudio = current.audioCache.fullSentence;
      await speak(phraseToSpeak, language, cachedAudio);
      console.log("Speak call finished in repeatSentence.");
    } catch (error) {
      console.error("Error during speak call in repeatSentence:", error);
       // Consider showing a user-facing message here
    } finally {
      // CRITICAL: Ensure isSpeaking is set to false regardless of success/failure
      console.log("Setting isSpeaking to false in repeatSentence finally block.");
      setIsSpeaking(false);
    }
  };

  // Show/Reshuffle Words Handler
  const reshuffleWords = () => {
    if (isLoading) return; // Don't reshuffle while loading
    setShuffled(shuffleArray(current.words));
    setShuffleVersion((v) => v + 1); // Increment key to force WordTile remount/reposition
    setWordStatus({}); // Clear correct/incorrect status on reshuffle
    if (!showWords) {
        setShowWords(true); // Show words if they were hidden
    }
  };

  // Next Phrase Handler
  const nextPhrase = () => {
    if (!phrases.length || isLoading || isSpeaking) return; // Prevent advancing while loading/speaking
    let newIdx = idx;
    if (phrases.length > 1) {
      // Ensure the next index is different from the current one
      while (newIdx === idx) {
        newIdx = Math.floor(Math.random() * phrases.length);
      }
    } else {
      // If only one phrase, stay at index 0
      newIdx = 0;
    }
    console.log(`Moving to next phrase index: ${newIdx}`);
    setIdx(newIdx);
    // State resets will be handled by the useEffect hook monitoring `idx`
  };

  // Go Home Handler
  const goHome = () => {
    if (isLoading) return;
    console.log("Navigating Home");
    setCurrentSection(null); // This will trigger the useEffect to reset state
    setIdx(0); // Reset index as well
     // Cancel any ongoing speech synthesis when going home
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
          console.log("Cancelling speech synthesis due to navigating home.");
          window.speechSynthesis.cancel();
          setIsSpeaking(false);
      }
  };

  // Select Section Handler
  const selectSection = (sectionName) => {
      if (isLoading) return;
      console.log(`Selecting section: ${sectionName}`);
      setCurrentSection(sectionName);
      setIdx(0); // Start at the first phrase of the new section
       // State resets will be handled by the useEffect hook monitoring `currentSection`
  };

  // Change Language Handler
  const handleLanguageChange = (e) => {
      if (isLoading) return; // Prevent changing language while loading
      const newLang = e.target.value;
      console.log(`Changing language to: ${newLang}`);
      setLanguage(newLang);
      // Loading and state reset will be handled by the useEffect hook monitoring `language`
  };


  // ─────────── Render Logic ─────────── //

  const renderHome = () => (
    <div className="home-screen">
      <h1>Learn {LANGUAGE_NAMES[language] || language} Game</h1> {/* Fallback to code if name not found */}
      <div className="language-selector">
        <label htmlFor="language" className="mr-2">Language:</label>
        <select id="language" value={language} onChange={handleLanguageChange} disabled={isLoading}>
          {Object.keys(LANGUAGE_NAMES).map((code) => (
            <option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>
          ))}
          {/* Optionally add languages not in LANGUAGE_NAMES if needed */}
        </select>
      </div>

      {Object.keys(sections).length > 0 ? (
          <>
            <p className="mt-4">Select a section:</p>
            <div className="section-buttons">
              {Object.keys(sections).map((sec) => (
                <button key={sec} className="section-btn" onClick={() => selectSection(sec)} disabled={isLoading}>
                  {sec}
                </button>
              ))}
            </div>
          </>
      ) : (
         <p className="mt-4 text-gray-500">No sections loaded for this language yet.</p>
      )}
    </div>
  );

  const renderGame = () => {
     // Determine if the 'Next' button should be enabled
     const canGoNext = showWords ? clicked.length === current.words.length : true;

     return (
        <div className="game-screen">
          {/* Top Bar */}
          <div className="top-bar">
            <button className="home-btn" onClick={goHome} disabled={isLoading}>Home</button>
            <h2>{currentSection}</h2>
             {/* Maybe add a language indicator here too? */}
          </div>

          {/* Sentence Display */}
          <div className="sentence-display flex items-center justify-center gap-2 min-h-[2em] my-2 px-4 text-center">
            <span>{clicked.join(" ")}</span>
            {/* Show repeat button only when complete and not speaking */}
            {clicked.length === current.words.length && !isSpeaking && (
              <button
                className="repeat-btn"
                title="Repeat"
                onClick={repeatSentence}
                disabled={isSpeaking || isLoading} // Extra safety disable
              >
                🔊
              </button>
            )}
             {/* Show speaker icon while speaking */}
             {isSpeaking && (
                 <span className="speaking-indicator" title="Speaking...">📢</span>
             )}
          </div>

          {/* Controls */}
          <div className="controls flex justify-center gap-2 mt-3 mb-3">
            <button className="show-words-btn" onClick={reshuffleWords} disabled={isLoading || isSpeaking}>
              {showWords ? "Reshuffle" : "Show Words"}
            </button>
            {langNeedsHint && current.hint && ( // Only show hint button if hint exists
              <button className="hint-btn" onClick={() => setShowHint((v) => !v)} disabled={isLoading || isSpeaking}>
                {showHint ? "Hide Hint" : "Hint"}
              </button>
            )}
          </div>

          {/* Word Tiles Container - needs defined height */}
          <div className="word-tiles-container relative h-60 md:h-72 w-full max-w-2xl mx-auto border border-gray-300 rounded overflow-hidden my-4">
            {shuffled.map((w, index) => ( // Add index for slightly better key uniqueness if words repeat
              <WordTile
                key={`${w}-${index}-${shuffleVersion}`} // Use shuffleVersion in key
                word={w}
                hidden={!showWords || clicked.includes(w)}
                isCorrect={wordStatus[w]} // Pass status directly
                onClick={handleWordClick} // Pass the handler
              />
            ))}
            {/* Message when words aren't shown */}
            {!showWords && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                    Click "Show Words" to begin.
                </div>
            )}
          </div>

          {/* Translation and Next Button Section */}
          <div className="translation-footer flex flex-col items-center gap-2 mt-4">
            <div className="flex items-center justify-center flex-wrap gap-2 px-4 text-center">
              <p className="translation-text">{current.translation}</p>
              <button
                className="next-button"
                onClick={nextPhrase}
                // Enable Next if words are hidden OR if sentence is complete
                disabled={!canGoNext || isLoading || isSpeaking}
              >
                Next
              </button>
            </div>
          </div>

          {/* Hint Section - Placed below Next button */}
          {showHint && current.hint && (
            <div className="hint-container w-full text-center mt-2 px-4">
              <p className="hint-text text-sm italic text-gray-600">
                Hint: {current.hint}
              </p>
            </div>
          )}

          {/* Progress Indicator */}
           {phrases.length > 0 && (
             <div className="progress-indicator text-xs text-gray-400 text-center mt-4">
                 Phrase {idx + 1} of {phrases.length} in this section (random order)
             </div>
           )}
        </div>
     );
   };


  // ──────────── Component Output ──────────── //
  return (
    <div className="app container mx-auto p-4 flex flex-col items-center">
      <LoadingOverlay isLoading={isLoading} message={loadingMsg} />
      {/* Conditionally render based on loading state and current section */}
      {!isLoading && (currentSection === null ? renderHome() : renderGame())}
       {/* Basic Footer */}
       <footer className="mt-8 text-center text-xs text-gray-400">
           {/* Add credits, links, etc. here if desired */}
           TTS powered by ElevenLabs (if API key provided) or Browser Fallback.
       </footer>
    </div>
  );
}