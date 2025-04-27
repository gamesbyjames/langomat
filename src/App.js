import React, { useEffect, useState, useMemo, useCallback } from "react"; // Added useMemo, useCallback
import "./App.css";

// ──────────── ElevenLabs API configuration ──────────── //
// (Keep your existing API key logic here)
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
const VOICE_IDS = { // Keep your VOICE_IDS
  "de-DE": "EXAVITQu4vr4xnSDxMaL",
  "tr-TR": "pNInz6obpgDQGcFmaJgB",
  "fr-FR": "ErXwobaYiN019PkySvjV",
  "po-PO": "ErXwobaYiN019PkySvjV", // Assuming Portuguese should be pt-PT or pt-BR? Using FR voice as placeholder
  "it-IT": "ErXwobaYiN019PkySvjV", // Using FR voice as placeholder
  "en-US": "21m00Tcm4TlvDq8ikWAM",
  "es-ES": "ThT5KcBeYPX3keUQqHPh",
  "el-GR": "ThT5KcBeYPX3keUQqHPh", // Using ES voice as placeholder
};

const LANGUAGE_NAMES = { // Keep your LANGUAGE_NAMES
  "de-DE": "German",
  "tr-TR": "Turkish",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "po-PO": "Portuguese", // Adjust based on actual voice ID language
  "it-IT": "Italian",
  "el-GR": "Greek",
};

const HINT_LANGS = ["el-GR", "ru-RU", "ja-JP", "fa-IR"]; // Keep your HINT_LANGS

// ──────────── utility helpers ──────────── //
const shuffleArray = (array) => {
  // (Implementation unchanged)
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

async function loadPhrasesFromFile(url) {
  // (Implementation mostly unchanged)
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch error ${res.status}`);
    const text = await res.text();
    return parsePhrases(text); // Call the modified parser
  } catch (err) {
    console.error("loadPhrasesFromFile", err);
    // Keep fallback structure
    return {
      Demo: [
        { words: ["Hola", "¿qué", "tal?"], translation: "Hello, how are you?", hint: null, audioCache: {} },
      ],
    };
  }
}

// --- Modified parsePhrases ---
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
      audioCache: {},
    });
  });

  // REMOVED: Object.keys(sections).forEach((s) => (sections[s] = shuffleArray(sections[s])));
  // Sections are now returned in the order they were encountered in the file.
  return sections;
}


// ──────────── TTS helpers ──────────── //
// (generateSpeech, fallbackSpeak, speak functions remain unchanged)
async function generateSpeech(text, language = "de-DE") {
    if (!ELEVEN_LABS_API_KEY) {
        console.warn("generateSpeech called without API key.");
        return null;
    }
    const voiceId = VOICE_IDS[language] || VOICE_IDS["de-DE"]; // Ensure fallback voice exists
    try {
      const res = await fetch(`${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": ELEVEN_LABS_API_KEY },
        body: JSON.stringify({
          text, model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        }),
      });
      if (!res.ok) {
        let errorBody = "Unknown API error"; try { const errorJson = await res.json(); errorBody = errorJson.detail ? JSON.stringify(errorJson.detail) : res.statusText; } catch (parseErr) { /* Ignore */ }
        throw new Error(`TTS API Error ${res.status}: ${errorBody}`);
      }
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (err) { console.error("generateSpeech Error:", err); return null; }
}

function fallbackSpeak(text, lang = "de-DE", rate = 0.8) {
    return new Promise((resolve, reject) => {
      const MAX_WAIT_TIME = 5000;
      if (!window.speechSynthesis) return reject(new Error("SpeechSynthesis API not supported"));

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang; utterance.rate = rate;
      let resolved = false, timeoutId = null;

      const cleanup = () => { clearTimeout(timeoutId); if (window.speechSynthesis.speaking) window.speechSynthesis.cancel(); utterance.onend = null; utterance.onerror = null; if (window.speechSynthesis.onvoiceschanged === trySpeakWithVoices) window.speechSynthesis.onvoiceschanged = null; };
      utterance.onend = () => { if (resolved) return; resolved = true; cleanup(); resolve(); };
      utterance.onerror = (event) => { if (resolved) return; console.error("SpeechSynthesis Error:", event.error); resolved = true; cleanup(); reject(new Error(`SpeechSynthesis Error: ${event.error || 'Unknown'}`)); };
      timeoutId = setTimeout(() => { if (resolved) return; console.warn(`Fallback TTS timed out`); resolved = true; cleanup(); reject(new Error(`SpeechSynthesis timed out`)); }, MAX_WAIT_TIME);

      const trySpeakWithVoices = () => {
        if (window.speechSynthesis.onvoiceschanged === trySpeakWithVoices) window.speechSynthesis.onvoiceschanged = null; // Clear listener if set
        try {
          const voices = window.speechSynthesis.getVoices();
          const voice = voices.find(v => v.lang === lang && v.localService) || voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(lang.split("-")[0]) && v.localService) || voices.find(v => v.lang.startsWith(lang.split("-")[0]));
          if (voice) { utterance.voice = voice; console.log(`Using voice: ${voice.name} (${voice.lang})`); } else console.warn(`No specific voice found for lang "${lang}".`);
          if (window.speechSynthesis.pending || window.speechSynthesis.speaking) window.speechSynthesis.cancel();
          setTimeout(() => { if (resolved) return; try { window.speechSynthesis.speak(utterance); } catch (speakError) { if (resolved) return; console.error("Error calling speak():", speakError); resolved = true; cleanup(); reject(speakError); } }, 50);
        } catch (err) { if (resolved) return; console.error("Error during fallbackSpeak setup:", err); resolved = true; cleanup(); reject(err); }
      };

      const initialVoices = window.speechSynthesis.getVoices();
      if (initialVoices.length > 0) trySpeakWithVoices();
      else if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = trySpeakWithVoices;
      else trySpeakWithVoices();
    });
}

async function speak(text, language = "de-DE", cachedUrl = null) {
    let generatedUrl = null;
    try {
      if (cachedUrl) generatedUrl = cachedUrl;
      else if (ELEVEN_LABS_API_KEY) {
        generatedUrl = await generateSpeech(text, language);
        if (!generatedUrl) throw new Error("ElevenLabs generation failed");
      } else throw new Error("No API key provided, using fallback.");

      if (generatedUrl) {
        await new Promise((resolve, reject) => {
          const audio = new Audio(generatedUrl);
          audio.onended = resolve;
          audio.onerror = (e) => { let msg = "HTML Audio error."; if (audio.error) msg += ` Code: ${audio.error.code}, Msg: ${audio.error.message}`; reject(new Error(msg)); };
          const playPromise = audio.play();
          if (playPromise !== undefined) playPromise.catch((err) => reject(new Error(`Audio play() rejected: ${err.message}`)));
        });
        return generatedUrl;
      }
      throw new Error("Generated URL unexpectedly null");
    } catch (err) {
      console.warn(`Speak function error, fallback: ${err.message}`);
      try { await fallbackSpeak(text, language); return null; }
      catch (fallbackErr) { console.error("Fallback TTS failed:", fallbackErr); return null; }
    }
}


// ──────────── Components ──────────── //
// (LoadingOverlay, WordTile components remain unchanged)
const LoadingOverlay = ({ isLoading, message }) =>
  !isLoading ? null : (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 text-white z-50">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"></div>
      <p className="text-lg font-semibold">{message}</p>
    </div>
  );

function WordTile({ word, hidden, isCorrect, onClick }) {
  const [pos] = useState({ top: Math.random() * 70 + 5, left: Math.random() * 70 + 5 });
  if (hidden) return null;
  return (
    <div
      style={{ top: `${pos.top}%`, left: `${pos.left}%` }}
      className={`word-tile ${isCorrect === true ? "correct" : isCorrect === false ? "incorrect" : ""}`}
      onClick={() => onClick(word)}
    >
      {word}
    </div>
  );
}

// ──────────── Main App ──────────── //
export default function App() {
  // --- State ---
  const [language, setLanguage] = useState("de-DE");
  const [sections, setSections] = useState({}); // Holds ALL loaded phrases in original order
  const [currentSection, setCurrentSection] = useState(null); // Name of the selected section
  const [idx, setIdx] = useState(0); // Index within the activePhrases list
  const [isRandomOrder, setIsRandomOrder] = useState(false); // <-- New state for order toggle

  const [shuffledWords, setShuffledWords] = useState([]); // Words for the *current* phrase, shuffled for display
  const [shuffleVersion, setShuffleVersion] = useState(0);
  const [clicked, setClicked] = useState([]); // Words clicked in current attempt
  const [wordStatus, setWordStatus] = useState({});
  const [showWords, setShowWords] = useState(false); // Tiles visibility
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const [loadingMsg, setLoadingMsg] = useState("Loading...");
  const [isLoading, setIsLoading] = useState(true);

  // --- Derived State & Memoization ---

  // activePhrases: The list of phrases for the current section, ordered according to the toggle
  const activePhrases = useMemo(() => {
    if (!currentSection || !sections[currentSection]) {
      return []; // No section selected or section empty
    }
    const originalPhrases = sections[currentSection];
    if (isRandomOrder) {
       console.log(`Memo: Shuffling phrases for section ${currentSection}`);
       return shuffleArray(originalPhrases);
    } else {
       console.log(`Memo: Using sequential phrases for section ${currentSection}`);
       return originalPhrases; // Return in original order
    }
  }, [sections, currentSection, isRandomOrder]); // Recalculate when these change

  // current: The specific phrase object currently being worked on
  const current = useMemo(() => {
      // Get phrase from the active (potentially shuffled) list
      return activePhrases[idx] || { words: [], translation: "Loading...", hint: null, audioCache: {} };
  }, [activePhrases, idx]); // Recalculate when active list or index changes

  const langNeedsHint = HINT_LANGS.some((l) => language.startsWith(l));

  // --- Effects ---

  // Load phrases file when language changes
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setLoadingMsg(`Loading ${LANGUAGE_NAMES[language]} phrases...`);
      setSections({}); setCurrentSection(null); setIdx(0); // Reset section state

      const fileMap = { /* Keep your file map */
        "de-DE": "german_phrases.txt", "tr-TR": "phrases.txt", "fr-FR": "french_phrases.txt",
        "es-ES": "spanish_phrases.txt", "po-PO": "portuguese_phrases.txt", "it-IT": "italian_phrases.txt",
        "el-GR": "greek_phrases.txt",
      };
      const fileName = fileMap[language] || "german_phrases.txt";
      const data = await loadPhrasesFromFile(`${process.env.PUBLIC_URL}/${fileName}`);
      setSections(data);
      setIsLoading(false);
    })();
  }, [language]);

  // Reset UI state when phrase changes (index, section, order mode, or underlying phrase data change)
  useEffect(() => {
    // Check if the *current* phrase object (derived from activePhrases[idx]) has words
    if (current && current.words && current.words.length > 0) {
      console.log("Resetting UI for phrase:", current.words.join(" "));
      setShuffledWords(shuffleArray(current.words)); // Shuffle words of the *current* phrase
      setShuffleVersion((v) => v + 1);
      setClicked([]);
      setWordStatus({});
      setShowWords(false);
      setShowHint(false);
      if (window.speechSynthesis?.speaking) {
        console.log("Cancelling speech due to phrase/order change.");
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
    } else if (!currentSection) { // Also reset fully when going home
      setClicked([]); setWordStatus({}); setShowWords(false); setShowHint(false);
    }
  }, [current, currentSection]); // Depend on the derived 'current' phrase object and section


  // --- Handlers (using useCallback for stable references where needed) ---

  const handleWordClick = useCallback(async (word) => {
    if (!showWords || isSpeaking || isLoading || !current || !current.words) return;

    const expected = current.words[clicked.length];

    if (word === expected) {
      setWordStatus((prev) => ({ ...prev, [word]: true }));
      const newArr = [...clicked, word];
      setClicked(newArr);

      if (newArr.length === current.words.length) {
        setIsSpeaking(true);
        try {
          const phraseToSpeak = current.words.join(" ");
          const cachedAudio = current.audioCache.fullSentence; // Access cache on current phrase object
          const spokenUrl = await speak(phraseToSpeak, language, cachedAudio);

          // Update cache if new URL generated (more robust state update recommended for production)
          if (spokenUrl && !cachedAudio && activePhrases[idx]) {
              console.log("Caching generated full sentence audio.");
              // This direct mutation works but isn't ideal React practice.
              activePhrases[idx].audioCache.fullSentence = spokenUrl;
          }
        } catch (error) { console.error("Error speaking completed sentence:", error); }
        finally { setIsSpeaking(false); }
      }
    } else {
      setWordStatus((prev) => ({ ...prev, [word]: false }));
      setTimeout(() => setWordStatus((prev) => ({ ...prev, [word]: undefined })), 800);
    }
  }, [showWords, isSpeaking, isLoading, current, clicked, language, activePhrases, idx]); // Added dependencies

  const repeatSentence = useCallback(async () => {
    if (!current || !current.words || clicked.length !== current.words.length || isSpeaking || isLoading) return;
    setIsSpeaking(true);
    try {
      const phraseToSpeak = current.words.join(" ");
      const cachedAudio = current.audioCache.fullSentence;
      await speak(phraseToSpeak, language, cachedAudio);
    } catch (error) { console.error("Error repeating sentence:", error); }
    finally { setIsSpeaking(false); }
  }, [clicked, current, isSpeaking, isLoading, language]); // Added dependencies

  const reshuffleWordsHandler = useCallback(() => { // Renamed to avoid conflict
    if (isLoading || !current || !current.words) return;
    setShuffledWords(shuffleArray(current.words));
    setShuffleVersion((v) => v + 1);
    setWordStatus({});
    if (!showWords) setShowWords(true);
  }, [isLoading, current, showWords]); // Added dependencies

  // --- Modified nextPhrase ---
  const nextPhrase = useCallback(() => {
    if (!activePhrases.length || isLoading || isSpeaking) return;

    let newIdx = idx;
    if (activePhrases.length > 1) {
        if (isRandomOrder) {
            // Pick random DIFFERENT index
            while (newIdx === idx) {
                newIdx = Math.floor(Math.random() * activePhrases.length);
            }
        } else {
            // Go to next sequential index, wrap around
            newIdx = (idx + 1) % activePhrases.length;
        }
    } else {
      newIdx = 0; // Stay at 0 if only one phrase
    }

    console.log(`Moving to ${isRandomOrder ? 'random' : 'sequential'} phrase index: ${newIdx}`);
    setIdx(newIdx);
    // Reset effect will handle UI update
  }, [activePhrases, idx, isLoading, isSpeaking, isRandomOrder]); // Added isRandomOrder dependency

  const goHome = useCallback(() => {
    if (isLoading) return;
    setCurrentSection(null); setIdx(0); // Reset section and index
    if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel(); // Cancel speech
    setIsSpeaking(false);
  }, [isLoading]);

  const selectSection = useCallback((sectionName) => {
      if (isLoading) return;
      setCurrentSection(sectionName);
      setIdx(0); // Start at first phrase of the section
  }, [isLoading]);

  const handleLanguageChange = useCallback((e) => {
      if (isLoading) return;
      setLanguage(e.target.value);
      // Loading effect handles the rest
  }, [isLoading]);

  // --- New handler for the toggle ---
  const handleOrderToggle = useCallback((event) => {
      const newIsRandom = event.target.checked;
      console.log(`Setting order to: ${newIsRandom ? 'Random' : 'Sequential'}`);
      setIsRandomOrder(newIsRandom);
      setIdx(0); // Reset to the start of the new sequence
      // The useMemo for activePhrases and the useEffect for UI reset will handle the rest
  }, []); // No dependencies needed


  // ─────────── Render Logic ─────────── //

  const renderHome = () => (
    // (Home screen render logic unchanged)
    <div className="home-screen">
      <h1>Learn {LANGUAGE_NAMES[language] || language} Game</h1>
      <div className="language-selector">
        <label htmlFor="language" className="mr-2">Language:</label>
        <select id="language" value={language} onChange={handleLanguageChange} disabled={isLoading}>
          {Object.keys(LANGUAGE_NAMES).map((code) => (<option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>))}
        </select>
      </div>
      {Object.keys(sections).length > 0 ? (
        <>
          <p className="mt-4">Select a section:</p>
          <div className="section-buttons">
            {Object.keys(sections).map((sec) => (<button key={sec} className="section-btn" onClick={() => selectSection(sec)} disabled={isLoading}>{sec}</button>))}
          </div>
        </>
      ) : (<p className="mt-4 text-gray-500">No sections loaded.</p>)}
    </div>
  );

  const renderGame = () => {
     const canGoNext = showWords ? clicked.length === current.words.length : true;
     const totalPhrasesInSection = activePhrases.length; // Use length of the active list

     return (
        <div className="game-screen">
          {/* Top Bar */}
          <div className="top-bar">
            <button className="home-btn" onClick={goHome} disabled={isLoading}>Home</button>
            <h2>{currentSection}</h2>
            {/* --- Order Toggle Checkbox --- */}
            <div className="order-toggle ml-auto flex items-center gap-1 text-sm pr-2">
                <label htmlFor="randomOrder">Random:</label>
                <input
                    type="checkbox"
                    id="randomOrder"
                    checked={isRandomOrder}
                    onChange={handleOrderToggle}
                    disabled={isLoading || isSpeaking}
                />
            </div>
          </div>

          {/* Sentence Display */}
          <div className="sentence-display flex items-center justify-center gap-2 min-h-[2em] my-2 px-4 text-center">
            <span>{clicked.join(" ")}</span>
            {clicked.length === current.words.length && !isSpeaking && (<button className="repeat-btn" title="Repeat" onClick={repeatSentence} disabled={isSpeaking || isLoading}>🔊</button>)}
            {isSpeaking && (<span className="speaking-indicator" title="Speaking...">📢</span>)}
          </div>

          {/* Controls */}
          <div className="controls flex justify-center gap-2 mt-3 mb-3">
            <button className="show-words-btn" onClick={reshuffleWordsHandler} disabled={isLoading || isSpeaking}>{showWords ? "Reshuffle" : "Show Words"}</button>
            {langNeedsHint && current.hint && (<button className="hint-btn" onClick={() => setShowHint((v) => !v)} disabled={isLoading || isSpeaking}>{showHint ? "Hide Hint" : "Hint"}</button>)}
          </div>

          {/* Word Tiles Container */}
          <div className="word-tiles-container relative h-60 md:h-72 w-full max-w-2xl mx-auto border border-gray-300 rounded overflow-hidden my-4">
            {shuffledWords.map((w, index) => (
              <WordTile key={`${w}-${index}-${shuffleVersion}`} word={w} hidden={!showWords || clicked.includes(w)} isCorrect={wordStatus[w]} onClick={handleWordClick} />
            ))}
            {!showWords && (<div className="absolute inset-0 flex items-center justify-center text-gray-500">Click "Show Words" to begin.</div>)}
          </div>

          {/* Translation and Next Button */}
          <div className="translation-footer flex flex-col items-center gap-2 mt-4">
            <div className="flex items-center justify-center flex-wrap gap-2 px-4 text-center">
              <p className="translation-text">{current.translation}</p>
              <button className="next-button" onClick={nextPhrase} disabled={!canGoNext || isLoading || isSpeaking}>Next</button>
            </div>
          </div>

          {/* Hint Section */}
          {showHint && current.hint && (<div className="hint-container w-full text-center mt-2 px-4"><p className="hint-text text-sm italic text-gray-600">Hint: {current.hint}</p></div>)}

          {/* Progress Indicator */}
           {totalPhrasesInSection > 0 && (
             <div className="progress-indicator text-xs text-gray-400 text-center mt-4">
                 Phrase {idx + 1} of {totalPhrasesInSection} ({isRandomOrder ? 'random' : 'sequential'} order)
             </div>
           )}
        </div>
     );
   };

  // ──────────── Component Output ──────────── //
  return (
    <div className="app container mx-auto p-4 flex flex-col items-center">
      <LoadingOverlay isLoading={isLoading} message={loadingMsg} />
      {!isLoading && (currentSection === null ? renderHome() : renderGame())}
       <footer className="mt-4 text-center text-xs text-gray-400">
           TTS powered by ElevenLabs (if API key provided) or Browser Fallback.
       </footer>
    </div>
  );
}