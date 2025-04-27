import React, { useEffect, useState, useMemo, useCallback } from "react";
import "./App.css";

// ──────────── ElevenLabs API configuration ──────────── //
const API_KEY_STORAGE_KEY = "elevenLabsApiKey_v1"; // Use a consistent key
let ELEVEN_LABS_API_KEY = localStorage.getItem(API_KEY_STORAGE_KEY) || ""; // Load key once

// Check if key exists (useful for the indicator)
// We'll use state for this so the UI updates reactively
// const initialTtsProvider = ELEVEN_LABS_API_KEY ? 'ElevenLabs' : 'System';

const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1";
const VOICE_IDS = { // Keep your VOICE_IDS
  "de-DE": "EXAVITQu4vr4xnSDxMaL", "tr-TR": "pNInz6obpgDQGcFmaJgB", "fr-FR": "ErXwobaYiN019PkySvjV",
  "pt-PT": "ErXwobaYiN019PkySvjV", "it-IT": "IDsj33mlask8d5k8no2b", "en-US": "21m00Tcm4TlvDq8ikWAM",
  "es-ES": "ThT5KcBeYPX3keUQqHPh", "el-GR": "ThT5KcBeYPX3keUQqHPh",
};
const LANGUAGE_NAMES = { // Keep your LANGUAGE_NAMES
  "de-DE": "German", "tr-TR": "Turkish", "fr-FR": "French", "es-ES": "Spanish",
  "pt-PT": "Portuguese", "it-IT": "Italian", "el-GR": "Greek", "en-US": "English",
};
const HINT_LANGS = ["el-GR", "ru-RU", "ja-JP", "fa-IR"];

// ──────────── utility helpers ──────────── //
const shuffleArray = (array) => { const copy = [...array]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; };
async function loadPhrasesFromFile(url) { try { const res = await fetch(url); if (!res.ok) throw new Error(`Fetch error ${res.status}`); const text = await res.text(); return parsePhrases(text); } catch (err) { console.error("loadPhrasesFromFile", err); return { Demo: [{ words: ["Error"], translation: "Could not load phrases", hint: null, audioCache: {} }] }; } }
function parsePhrases(text) { const sections = {}; let currentSection = null; text.split("\n").forEach((raw) => { const line = raw.trim(); if (!line || line.startsWith("//")) return; if (line.startsWith("#")) { currentSection = line.replace(/^#/, "").replace(/:\s*$/, "").trim(); if (!sections[currentSection]) sections[currentSection] = []; return; } if (!currentSection) return; const barParts = line.split("|"); if (barParts.length < 2) return; const first = barParts[0].trim(); const rightSide = barParts.slice(1).join("|").trim(); let translation = rightSide; let hint = null; const colonIdx = rightSide.indexOf(":"); if (colonIdx !== -1) { translation = rightSide.slice(0, colonIdx).trim(); hint = rightSide.slice(colonIdx + 1).trim(); } sections[currentSection].push({ words: first.split(/\s+/).filter(Boolean), translation, hint: hint || null, audioCache: {} }); }); return sections; }

// ──────────── TTS helpers ──────────── //

// --- generateSpeech (uses global ELEVEN_LABS_API_KEY) ---
async function generateSpeech(text, language = "de-DE") {
    if (!ELEVEN_LABS_API_KEY) { // Directly check the global variable
        // console.warn("generateSpeech called without API key."); // Optional logging
        return null;
    }
    const voiceId = VOICE_IDS[language] || VOICE_IDS["de-DE"];
    try {
      const res = await fetch(`${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": ELEVEN_LABS_API_KEY },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (!res.ok) {
        let errorBody = "Unknown API error"; try { const errorJson = await res.json(); errorBody = errorJson.detail ? JSON.stringify(errorJson.detail) : res.statusText; } catch (parseErr) { /* Ignore */ }
        console.error(`TTS API Error ${res.status}: ${errorBody}`);
        return null; // Don't throw, let speak() handle fallback
      }
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (err) { console.error("generateSpeech Error:", err); return null; }
}

// fallbackSpeak remains unchanged
function fallbackSpeak(text, lang = "de-DE", rate = 0.8) { return new Promise((resolve, reject) => { const MAX_WAIT_TIME = 5000; if (!window.speechSynthesis) return reject(new Error("SpeechSynthesis API not supported")); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = lang; utterance.rate = rate; let resolved = false, timeoutId = null; const cleanup = () => { clearTimeout(timeoutId); if (window.speechSynthesis.speaking) window.speechSynthesis.cancel(); utterance.onend = null; utterance.onerror = null; if (window.speechSynthesis.onvoiceschanged === trySpeakWithVoices) window.speechSynthesis.onvoiceschanged = null; }; utterance.onend = () => { if (resolved) return; resolved = true; cleanup(); resolve(); }; utterance.onerror = (event) => { if (resolved) return; console.error("SpeechSynthesis Error:", event.error); resolved = true; cleanup(); reject(new Error(`SpeechSynthesis Error: ${event.error || 'Unknown'}`)); }; timeoutId = setTimeout(() => { if (resolved) return; console.warn(`Fallback TTS timed out`); resolved = true; cleanup(); reject(new Error(`SpeechSynthesis timed out`)); }, MAX_WAIT_TIME); const trySpeakWithVoices = () => { if (window.speechSynthesis.onvoiceschanged === trySpeakWithVoices) window.speechSynthesis.onvoiceschanged = null; try { const voices = window.speechSynthesis.getVoices(); const voice = voices.find(v => v.lang === lang && v.localService) || voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(lang.split("-")[0]) && v.localService) || voices.find(v => v.lang.startsWith(lang.split("-")[0])); if (voice) { utterance.voice = voice; console.log(`Using voice: ${voice.name} (${voice.lang})`); } else console.warn(`No specific voice found for lang "${lang}".`); if (window.speechSynthesis.pending || window.speechSynthesis.speaking) window.speechSynthesis.cancel(); setTimeout(() => { if (resolved) return; try { window.speechSynthesis.speak(utterance); } catch (speakError) { if (resolved) return; console.error("Error calling speak():", speakError); resolved = true; cleanup(); reject(speakError); } }, 50); } catch (err) { if (resolved) return; console.error("Error during fallbackSpeak setup:", err); resolved = true; cleanup(); reject(err); } }; const initialVoices = window.speechSynthesis.getVoices(); if (initialVoices.length > 0) trySpeakWithVoices(); else if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = trySpeakWithVoices; else trySpeakWithVoices(); }); }

// --- speak (uses global ELEVEN_LABS_API_KEY) ---
async function speak(text, language = "de-DE", cachedUrl = null) {
    let generatedUrl = null;
    let usePremium = !!ELEVEN_LABS_API_KEY; // Decide based on global variable existence

    try {
        if (cachedUrl) {
            console.log("Speak: Using cached audio URL.");
            generatedUrl = cachedUrl;
        } else if (usePremium) {
            console.log("Speak: Attempting ElevenLabs generation...");
            generatedUrl = await generateSpeech(text, language); // Checks key inside
            if (!generatedUrl) {
                console.log("Speak: ElevenLabs generation failed, attempting fallback.");
                throw new Error("ElevenLabs generation failed"); // Force fallback
            } else {
                 console.log("Speak: ElevenLabs generation successful.");
            }
        } else {
            // No cached URL and no API key
            console.log("Speak: No API key, using browser fallback.");
            throw new Error("Skipping premium TTS, using fallback.");
        }

        // If we have a URL (cached or generated)
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
        throw new Error("Generated URL unexpectedly null after processing");

    } catch (err) {
        console.warn(`Speak function caught error, attempting fallback: ${err.message}`);
        try { await fallbackSpeak(text, language); return null; }
        catch (fallbackErr) { console.error("Fallback TTS also failed:", fallbackErr); return null; }
    }
}


// ──────────── Components ──────────── //
const LoadingOverlay = ({ isLoading, message }) => !isLoading ? null : ( <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 text-white z-50"> <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"></div> <p className="text-lg font-semibold">{message}</p> </div> );
function WordTile({ word, hidden, isCorrect, onClick }) { const [pos] = useState({ top: Math.random() * 70 + 5, left: Math.random() * 70 + 5 }); if (hidden) return null; return ( <div style={{ top: `${pos.top}%`, left: `${pos.left}%` }} className={`word-tile ${isCorrect === true ? "correct" : isCorrect === false ? "incorrect" : ""}`} onClick={() => onClick(word)}> {word} </div> ); }


// ──────────── Main App ──────────── //
export default function App() {
  // --- State ---
  const [language, setLanguage] = useState(() => localStorage.getItem("langLearningGameLang") || "de-DE");
  const [sections, setSections] = useState({});
  const [currentSection, setCurrentSection] = useState(null);
  const [idx, setIdx] = useState(0);
  const [isRandomOrder, setIsRandomOrder] = useState(() => JSON.parse(localStorage.getItem("langLearningGameRandom") ?? 'true'));
  const [ttsProvider, setTtsProvider] = useState(() => ELEVEN_LABS_API_KEY ? 'ElevenLabs' : 'System'); // State for indicator

  const [shuffledWords, setShuffledWords] = useState([]);
  const [shuffleVersion, setShuffleVersion] = useState(0);
  const [clicked, setClicked] = useState([]);
  const [wordStatus, setWordStatus] = useState({});
  const [showWords, setShowWords] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const [loadingMsg, setLoadingMsg] = useState("Loading...");
  const [isLoading, setIsLoading] = useState(true);


  // --- Derived State & Memoization ---
  const activePhrases = useMemo(() => { if (!currentSection || !sections[currentSection]) return []; const original = sections[currentSection]; return isRandomOrder ? shuffleArray(original) : original; }, [sections, currentSection, isRandomOrder]);
  const current = useMemo(() => activePhrases[idx] || { words: [], translation: "Loading...", hint: null, audioCache: {} }, [activePhrases, idx]);
  const langNeedsHint = useMemo(() => HINT_LANGS.some((l) => language.startsWith(l)), [language]);


  // --- Effects ---
  // Load phrases file when language changes
   useEffect(() => {
     let isMounted = true;
     (async () => {
       setIsLoading(true); // Show loading for phrases
       setLoadingMsg(`Loading ${LANGUAGE_NAMES[language] || language} phrases...`);
       setSections({}); setCurrentSection(null); setIdx(0);

       const fileMap = { /* Your file map */
         "de-DE": "german_phrases.txt", "tr-TR": "phrases.txt", "fr-FR": "french_phrases.txt",
         "es-ES": "spanish_phrases.txt", "pt-PT": "portuguese_phrases.txt", "it-IT": "italian_phrases.txt",
         "el-GR": "greek_phrases.txt", "en-US": "english_phrases.txt",
       };
       const fileName = fileMap[language] || fileMap["de-DE"]; // Default
       const data = await loadPhrasesFromFile(`${process.env.PUBLIC_URL}/${fileName}`);
       if (isMounted) {
          setSections(data);
          setIsLoading(false);
       }
     })();
     return () => { isMounted = false };
   }, [language]); // Only depends on language now


  // Reset UI state when phrase changes
  useEffect(() => { if (current?.words?.length > 0) { setShuffledWords(shuffleArray(current.words)); setShuffleVersion(v => v + 1); setClicked([]); setWordStatus({}); setShowWords(false); setShowHint(false); if (window.speechSynthesis?.speaking) { window.speechSynthesis.cancel(); setIsSpeaking(false); } } else if (!currentSection) { setClicked([]); setWordStatus({}); setShowWords(false); setShowHint(false); } }, [current, currentSection]);

  // Save language preference
  useEffect(() => { localStorage.setItem("langLearningGameLang", language); }, [language]);
  // Save random order preference
  useEffect(() => { localStorage.setItem("langLearningGameRandom", JSON.stringify(isRandomOrder)); }, [isRandomOrder]);


  // --- Handlers ---

  // Function to prompt for and update API Key
  const updateApiKey = useCallback(() => {
      const currentKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
      const newKeyInput = window.prompt("Enter your ElevenLabs API Key (leave blank to clear):", currentKey);

      if (newKeyInput !== null) { // Prompt wasn't cancelled
          const newKey = newKeyInput.trim();
          if (newKey) {
              ELEVEN_LABS_API_KEY = newKey; // Update global variable
              localStorage.setItem(API_KEY_STORAGE_KEY, newKey); // Save to storage
              setTtsProvider('ElevenLabs'); // Update indicator state
              console.log("API Key updated.");
              alert("API Key saved. Premium TTS will be used if the key is valid."); // Simple feedback
          } else {
              // User entered blank - clear the key
              ELEVEN_LABS_API_KEY = ""; // Update global variable
              localStorage.removeItem(API_KEY_STORAGE_KEY); // Remove from storage
              setTtsProvider('System'); // Update indicator state
              console.log("API Key cleared.");
               alert("API Key cleared. System TTS will be used.");
          }
      }
      // If prompt was cancelled (newKeyInput === null), do nothing
  }, []); // No dependencies needed as it reads/writes directly


  // Speak handler now implicitly uses the global key via speak()
  const handleSpeak = useCallback(async (text, lang, cachedUrl = null) => {
      if (isSpeaking) return null;
      setIsSpeaking(true);
      let generatedUrl = null;
      try {
          generatedUrl = await speak(text, lang, cachedUrl); // speak() checks global key
      } catch (error) { console.error(`Error in handleSpeak for "${text}":`, error); }
      finally { setIsSpeaking(false); }
      return generatedUrl;
  }, [isSpeaking]); // Doesn't need apiKey state dependencies anymore


  // Other handlers remain largely the same, using handleSpeak
  const handleWordClick = useCallback(async (word) => { if (!showWords || isSpeaking || isLoading || !current?.words) return; const expected = current.words[clicked.length]; if (word === expected) { setWordStatus((prev) => ({ ...prev, [word]: true })); const newArr = [...clicked, word]; setClicked(newArr); if (newArr.length === current.words.length) { const phraseToSpeak = current.words.join(" "); const cachedAudio = current.audioCache.fullSentence; const spokenUrl = await handleSpeak(phraseToSpeak, language, cachedAudio); if (spokenUrl && !cachedAudio && activePhrases[idx]) { activePhrases[idx].audioCache.fullSentence = spokenUrl; } } } else { setWordStatus((prev) => ({ ...prev, [word]: false })); setTimeout(() => setWordStatus((prev) => ({ ...prev, [word]: undefined })), 800); } }, [showWords, isSpeaking, isLoading, current, clicked, language, activePhrases, idx, handleSpeak]);
  const repeatSentence = useCallback(async () => { if (!current?.words || clicked.length !== current.words.length || isSpeaking || isLoading) return; const phraseToSpeak = current.words.join(" "); const cachedAudio = current.audioCache.fullSentence; await handleSpeak(phraseToSpeak, language, cachedAudio); }, [clicked, current, isSpeaking, isLoading, language, handleSpeak]);
  const reshuffleWordsHandler = useCallback(() => { if (isLoading || !current?.words) return; setShuffledWords(shuffleArray(current.words)); setShuffleVersion(v => v + 1); setWordStatus({}); if (!showWords) setShowWords(true); }, [isLoading, current, showWords]);
  const nextPhrase = useCallback(() => { if (!activePhrases.length || isLoading || isSpeaking) return; let newIdx = idx; if (activePhrases.length > 1) { if (isRandomOrder) { while (newIdx === idx) newIdx = Math.floor(Math.random() * activePhrases.length); } else newIdx = (idx + 1) % activePhrases.length; } else newIdx = 0; setIdx(newIdx); }, [activePhrases, idx, isLoading, isSpeaking, isRandomOrder]);
  const goHome = useCallback(() => { if (isLoading) return; setCurrentSection(null); setIdx(0); if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel(); setIsSpeaking(false); }, [isLoading]);
  const selectSection = useCallback((sectionName) => { if (isLoading) return; setCurrentSection(sectionName); setIdx(0); }, [isLoading]);
  const handleLanguageChange = useCallback((e) => { if (isLoading) return; setLanguage(e.target.value); }, [isLoading]);
  const handleOrderToggle = useCallback((event) => { setIsRandomOrder(event.target.checked); setIdx(0); }, []);


  // ─────────── Render Logic ─────────── //

  const renderHome = () => (
    <div className="home-screen">
      <h1>Language Learning Game</h1>

      {/* --- API Key Button --- */}
      <div className="my-4">
          <button
              onClick={updateApiKey}
              className="px-3 py-1.5 border rounded shadow-sm hover:bg-gray-100 text-sm bg-white"
              title="Set or Clear ElevenLabs API Key"
          >
              Set API Key
          </button>
      </div>


      <div className="language-selector mt-2">
        <label htmlFor="language" className="mr-2 font-medium">Select Language:</label>
        <select id="language" value={language} onChange={handleLanguageChange} disabled={isLoading} className="p-1 border rounded">
          {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (<option key={code} value={code}>{name}</option>))}
        </select>
      </div>
      {Object.keys(sections).length > 0 ? (
        <>
          <p className="mt-4 font-medium">Select a section:</p>
          <div className="section-buttons">
            {Object.keys(sections).map((sec) => (<button key={sec} className="section-btn" onClick={() => selectSection(sec)} disabled={isLoading}>{sec}</button>))}
          </div>
        </>
      ) : (
         !isLoading && <p className="mt-4 text-gray-500">Loading sections for {LANGUAGE_NAMES[language]}...</p>
      )}
    </div>
  );

  const renderGame = () => {
     const canGoNext = showWords ? clicked.length === current.words.length : true;
     const totalPhrasesInSection = activePhrases.length;

     return (
        <div className="game-screen w-full max-w-3xl">
          {/* Top Bar */}
          <div className="top-bar">
            <button className="home-btn" onClick={goHome} disabled={isLoading}>Home</button>
            <h2 className="truncate" title={currentSection || ''}>{currentSection || '...'}</h2>
            <div className="order-toggle ml-auto flex items-center gap-1 text-sm pr-2">
                <label htmlFor="randomOrder">Random:</label>
                <input type="checkbox" id="randomOrder" checked={isRandomOrder} onChange={handleOrderToggle} disabled={isLoading || isSpeaking} />
            </div>
          </div>

          {/* Sentence Display */}
          <div className="sentence-display flex items-center justify-center gap-2 min-h-[2em] my-2 px-4 text-center text-lg md:text-xl">
            <span>{clicked.join(" ") || (showWords ? "" : <span className="text-gray-400"> </span>) }</span>
            {clicked.length === current.words.length && !isSpeaking && (<button className="repeat-btn" title="Repeat Sentence" onClick={repeatSentence} disabled={isSpeaking || isLoading}>🔊</button>)}
            {isSpeaking && (<span className="speaking-indicator" title="Speaking...">📢</span>)}
          </div>

          {/* Controls */}
          <div className="controls flex justify-center gap-2 mt-3 mb-3">
            <button className="show-words-btn" onClick={reshuffleWordsHandler} disabled={isLoading || isSpeaking}>{showWords ? "Reshuffle Words" : "Show Words"}</button>
            {langNeedsHint && current.hint && (<button className="hint-btn" onClick={() => setShowHint((v) => !v)} disabled={isLoading || isSpeaking}>{showHint ? "Hide Hint" : "Show Hint"}</button>)}
          </div>

          {/* Word Tiles Container */}
          <div className="word-tiles-container relative h-60 md:h-72 w-full mx-auto border border-gray-300 rounded overflow-hidden my-4 bg-gray-50">
            {shuffledWords.map((w, index) => (<WordTile key={`${w}-${index}-${shuffleVersion}`} word={w} hidden={!showWords || clicked.includes(w)} isCorrect={wordStatus[w]} onClick={handleWordClick} />))}
            {!showWords && (<div className="absolute inset-0 flex items-center justify-center text-gray-500 pointer-events-none">Click "Show Words" to begin.</div>)}
          </div>

          {/* Translation and Next Button */}
          <div className="translation-footer flex flex-col items-center gap-2 mt-4">
            <div className="flex items-center justify-center flex-wrap gap-2 px-4 text-center">
              <p className="translation-text text-lg">{current.translation}</p>
              <button className="next-button" onClick={nextPhrase} disabled={!canGoNext || isLoading || isSpeaking}>Next Phrase</button>
            </div>
          </div>

          {/* Hint Section */}
          {showHint && current.hint && (<div className="hint-container w-full text-center mt-2 px-4"><p className="hint-text text-base italic text-gray-600">Hint: {current.hint}</p></div>)}

          {/* Progress Indicator */}
           {totalPhrasesInSection > 0 && (<div className="progress-indicator text-xs text-gray-400 text-center mt-4">Phrase {idx + 1} of {totalPhrasesInSection} ({isRandomOrder ? 'random' : 'sequential'} order)</div>)}
        </div>
     );
   };

  // ──────────── Component Output ──────────── //
  return (
    <div className="app container mx-auto p-4 flex flex-col items-center min-h-screen">
      <LoadingOverlay isLoading={isLoading} message={loadingMsg} />
      <div className="flex-grow w-full flex flex-col items-center">
        {/* Render Home or Game */}
         {!isLoading && (currentSection === null ? renderHome() : renderGame())}
         {/* Keep showing loading overlay if loading */}
         {isLoading && <div className="pt-10">Loading...</div> }
      </div>
       <footer className="mt-8 text-center text-xs text-gray-400 w-full flex justify-center items-center gap-4">
            {/* --- TTS Provider Indicator --- */}
            <span>Using: {ttsProvider} TTS</span>
            {/* Optionally keep the button here too */}
             <button
                 onClick={updateApiKey}
                 className="px-2 py-0.5 border rounded hover:bg-gray-100 text-xs"
                 title="Set or Clear ElevenLabs API Key"
             >
                 Set API Key
             </button>
       </footer>
    </div>
  );
}