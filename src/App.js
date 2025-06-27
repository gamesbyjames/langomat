import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import "./App.css";

// ──────────── ElevenLabs API configuration ──────────── //
const API_KEY_STORAGE_KEY = "elevenLabsApiKey_v1"; // consistent LS key
let ELEVEN_LABS_API_KEY = localStorage.getItem(API_KEY_STORAGE_KEY) || ""; // load once

const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1";
const VOICE_IDS = {
  // Core voices
  "de-DE": "EXAVITQu4vr4xnSDxMaL",
  "tr-TR": "pNInz6obpgDQGcFmaJgB",
  "fr-FR": "ErXwobaYiN019PkySvjV",
  "pt-PT": "ErXwobaYiN019PkySvjV",
  "it-IT": "ThT5KcBeYPX3keUQqHPh",
  "en-US": "21m00Tcm4TlvDq8ikWAM",
  "es-ES": "ThT5KcBeYPX3keUQqHPh",
  "el-GR": "ThT5KcBeYPX3keUQqHPh",
  // Extra voices
  "ru-RU": "ymDCYd8puC7gYjxIamPt",
  "hi-IN": "Ag50Eld5oCoZVliw70iY",
  "ar-AR": "EXAVITQu4vr4xnSDxMaL",
  // New languages (share neutral voice placeholders)
  "fa-IR": "EXAVITQu4vr4xnSDxMaL",
  "ja-JP": "EXAVITQu4vr4xnSDxMaL",
};

const LANGUAGE_NAMES = {
  "de-DE": "German",
  "tr-TR": "Turkish",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "pt-PT": "Portuguese",
  "it-IT": "Italian",
  "el-GR": "Greek",
  "en-US": "English",
  "ru-RU": "Russian",
  "hi-IN": "Hindi",
  "ar-AR": "Arabic",
  "fa-IR": "Farsi",
  "ja-JP": "Japanese",
};

// Languages whose writing system may need a hint / transliteration
const HINT_LANGS = ["el-GR", "ru-RU", "ja-JP", "fa-IR", "hi-IN", "ar-AR"];

// ──────────── helpers ──────────── //
const shuffleArray = (arr) => {
  const copy = [...arr];
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
    const txt = await res.text();
    return parsePhrases(txt);
  } catch (e) {
    console.error("loadPhrasesFromFile", e);
    return {
      Demo: [
        {
          words: ["Error"],
          translation: "Could not load phrases",
          hint: null,
          audioCache: {},
        },
      ],
    };
  }
}

function parsePhrases(text) {
  const sections = {};
  let current = null;
  text.split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    if (line.startsWith("#")) {
      current = line.replace(/^#/, "").replace(/:\s*$/, "").trim();
      if (!sections[current]) sections[current] = [];
      return;
    }
    if (!current) return;
    const bar = line.split("|");
    if (bar.length < 2) return;
    const foreign = bar[0].trim();
    const right = bar.slice(1).join("|").trim();
    let translation = right;
    let hint = null;
    const idx = right.indexOf(":");
    if (idx !== -1) {
      translation = right.slice(0, idx).trim();
      hint = right.slice(idx + 1).trim();
    }
    sections[current].push({
      words: foreign.split(/\s+/).filter(Boolean),
      translation,
      hint,
      audioCache: {},
    });
  });
  return sections;
}

// ──────────── TTS helpers ──────────── //
async function generateSpeech(text, lang = "de-DE") {
  if (!ELEVEN_LABS_API_KEY) return null;
  // pick a slower speed only for Arabic; everything else stays at 1.0
  const speedByLang = { "ar-AR": 0.8 };          // 0.8 ≈ 20 % slower
  const voiceId = VOICE_IDS[lang] || VOICE_IDS["de-DE"];
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
        voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
            speed: speedByLang[lang] ?? 1,   // NEW
          },
      }),
    });
    if (!res.ok) {
      console.error("TTS Error", res.status);
      return null;
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error("generateSpeech", err);
    return null;
  }
}

function fallbackSpeak(text, lang = "de-DE", rate = 0.85) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) return reject(new Error("SpeechSynthesis not supported"));
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = rate;
    utter.onend = resolve;
    utter.onerror = reject;
    window.speechSynthesis.speak(utter);
  });
}

async function speak(text, lang = "de-DE", cachedUrl = null) {
  try {
    let url = cachedUrl;
    if (!url && ELEVEN_LABS_API_KEY) url = await generateSpeech(text, lang);
    if (url) {
      const audio = new Audio(url);
      await audio.play();
      return url;
    }
    await fallbackSpeak(text, lang);
    return null;
  } catch (err) {
    console.error("speak", err);
    return null;
  }
}

// ──────────── UI components ──────────── //
const LoadingOverlay = ({ isLoading, message }) =>
  !isLoading ? null : (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 text-white z-50">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"></div>
      <p className="text-lg font-semibold">{message}</p>
    </div>
  );

function WordTile({ word, hidden, isCorrect, onClick }) {
  const [pos] = useState({
    top: Math.random() * 70 + 5,
    left: Math.random() * 70 + 5,
  });
  if (hidden) return null;
  return (
    <div
      style={{ top: `${pos.top}%`, left: `${pos.left}%` }}
      className={`word-tile ${
        isCorrect === true ? "correct" : isCorrect === false ? "incorrect" : ""
      }`}
      onClick={() => onClick(word)}
    >
      {word}
    </div>
  );
}

// ──────────── Main App ──────────── //
export default function App() {
  /* ---------- state ---------- */
  const [mode, setMode] = useState(() => localStorage.getItem("langLearningGameMode") || "test");
  const [language, setLanguage] = useState(() => localStorage.getItem("langLearningGameLang") || "de-DE");
  const [sections, setSections] = useState({});
  const [currentSection, setCurrentSection] = useState(null);
  const [idx, setIdx] = useState(0);
  const [isRandomOrder, setIsRandomOrder] = useState(() => JSON.parse(localStorage.getItem("langLearningGameRandom") ?? "true"));
  const [ttsProvider, setTtsProvider] = useState(() => (ELEVEN_LABS_API_KEY ? "ElevenLabs" : "System"));

  const [shuffledWords, setShuffledWords] = useState([]);
  const [shuffleVersion, setShuffleVersion] = useState(0);
  const [clicked, setClicked] = useState([]);
  const [wordStatus, setWordStatus] = useState({});
  const [showWords, setShowWords] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const [loadingMsg, setLoadingMsg] = useState("Loading...");
  const [isLoading, setIsLoading] = useState(true);

  /* ---------- derived ---------- */
  const activePhrases = useMemo(() => {
    if (!currentSection || !sections[currentSection]) return [];
    const original = sections[currentSection];
    return isRandomOrder ? shuffleArray(original) : original;
  }, [sections, currentSection, isRandomOrder]);

  const current = useMemo(
    () =>
      activePhrases[idx] || {
        words: [],
        translation: "Loading...",
        hint: null,
        audioCache: {},
      },
    [activePhrases, idx]
  );

  const langNeedsHint = useMemo(() => HINT_LANGS.includes(language), [language]);

  /* ---------- persist ---------- */
  useEffect(() => localStorage.setItem("langLearningGameMode", mode), [mode]);
  useEffect(() => localStorage.setItem("langLearningGameLang", language), [language]);
  useEffect(() => localStorage.setItem("langLearningGameRandom", JSON.stringify(isRandomOrder)), [isRandomOrder]);

  /* ---------- auto speak in learn mode ---------- */
  useEffect(() => {
    if (mode !== "learn" || !current?.words?.length) return;
    const sentence = current.words.join(" ");
    const cached = current.audioCache.fullSentence;
    handleSpeak(sentence, language, cached).then((url) => {
      if (url && !cached) current.audioCache.fullSentence = url;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, idx, current]);

  /* ---------- loading phrases when language changes ---------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoading(true);
      setLoadingMsg(`Loading ${LANGUAGE_NAMES[language] || language} phrases...`);
      setSections({});
      setCurrentSection(null);
      setIdx(0);

      const fileMap = {
        "de-DE": "german_phrases.txt",
        "tr-TR": "phrases.txt",
        "fr-FR": "french_phrases.txt",
        "es-ES": "spanish_phrases.txt",
        "pt-PT": "portuguese_phrases.txt",
        "it-IT": "italian_phrases.txt",
        "el-GR": "greek_phrases.txt",
        "en-US": "english_phrases.txt",
        "ru-RU": "russian_phrases.txt",
        "hi-IN": "hindi_phrases.txt",
        "ar-AR": "arabic_phrases.txt",
        "fa-IR": "farsi_phrases.txt",
        "ja-JP": "japanese_phrases.txt",
      };
      const fileName = fileMap[language] || fileMap["de-DE"];
      const data = await loadPhrasesFromFile(`${process.env.PUBLIC_URL}/${fileName}`);
      if (mounted) {
        setSections(data);
        setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [language]);

  /* ---------- reset UI when phrase changes ---------- */
  useEffect(() => {
    if (current?.words?.length) {
      setShuffledWords(shuffleArray(current.words));
      setShuffleVersion((v) => v + 1);
      setClicked([]);
      setWordStatus({});
      setShowWords(false);
      setShowHint(false);
      if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else if (!currentSection) {
      setClicked([]);
      setWordStatus({});
      setShowWords(false);
      setShowHint(false);
    }
  }, [current, currentSection]);

  /* ---------- handlers ---------- */
  const updateApiKey = useCallback(() => {
    const currentKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
    const input = window.prompt("Enter your ElevenLabs API Key (blank to clear):", currentKey);
    if (input === null) return; // cancelled
    const key = input.trim();
    if (key) {
      ELEVEN_LABS_API_KEY = key;
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
      setTtsProvider("ElevenLabs");
      alert("API key saved。");
    } else {
      ELEVEN_LABS_API_KEY = "";
      localStorage.removeItem(API_KEY_STORAGE_KEY);
      setTtsProvider("System");
      alert("API key cleared。");
    }
  }, []);

  const handleSpeak = useCallback(async (text, lang, cachedUrl = null) => {
    if (isSpeaking) return null;
    setIsSpeaking(true);
    try {
      const url = await speak(text, lang, cachedUrl);
      return url;
    } finally {
      setIsSpeaking(false);
    }
  }, [isSpeaking]);

  const handleWordClick = useCallback(async (word) => {
    if (!showWords || isSpeaking || isLoading || !current?.words) return;
    const expected = current.words[clicked.length];
    if (word === expected) {
      setWordStatus((p) => ({ ...p, [word]: true }));
      const newArr = [...clicked, word];
      setClicked(newArr);
      if (newArr.length === current.words.length) {
        const sentence = current.words.join(" ");
        const cache = current.audioCache.fullSentence;
        const url = await handleSpeak(sentence, language, cache);
        if (url && !cache) current.audioCache.fullSentence = url;
      }
    } else {
      setWordStatus((p) => ({ ...p, [word]: false }));
      setTimeout(() => setWordStatus((p) => ({ ...p, [word]: undefined })), 800);
    }
  }, [showWords, isSpeaking, isLoading, current, clicked, language, handleSpeak]);

  const repeatSentence = useCallback(async () => {
    if (!current?.words || clicked.length !== current.words.length || isSpeaking || isLoading) return;
    const sentence = current.words.join(" ");
    const cache = current.audioCache.fullSentence;
    await handleSpeak(sentence, language, cache);
  }, [clicked, current, isSpeaking, isLoading, language, handleSpeak]);

  const reshuffleWords = useCallback(() => {
    if (isLoading || !current?.words) return;
    setShuffledWords(shuffleArray(current.words));
    setShuffleVersion((v) => v + 1);
    setWordStatus({});
    if (!showWords) setShowWords(true);
  }, [isLoading, current, showWords]);

  const nextPhrase = useCallback(() => {
    if (!activePhrases.length || isLoading || isSpeaking) return;
    let newIdx = idx;
    if (activePhrases.length > 1) {
      if (isRandomOrder) {
        while (newIdx === idx) newIdx = Math.floor(Math.random() * activePhrases.length);
      } else newIdx = (idx + 1) % activePhrases.length;
    } else newIdx = 0;
    setIdx(newIdx);
  }, [activePhrases, idx, isRandomOrder, isLoading, isSpeaking]);

  const goHome = useCallback(() => {
    if (isLoading) return;
    setCurrentSection(null);
    setIdx(0);
    if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [isLoading]);

  const selectSection = useCallback((sec) => {
    if (isLoading) return;
    setCurrentSection(sec);
    setIdx(0);
  }, [isLoading]);

  const handleLanguageChange = useCallback((e) => setLanguage(e.target.value), []);

  const handleOrderToggle = useCallback((e) => {
    setIsRandomOrder(e.target.checked);
    setIdx(0);
  }, []);

  /* ---------- mode toggle ---------- */
  const toggleMode = useCallback((e) => {
  setShowHint(false);      // reset
  setMode(e.target.value);
}, []);


  /* ---------- render ---------- */
  const renderHome = () => (
    <div className="home-screen">
      <h1>Language Learning Game</h1>

      {/* API key button */}
      <div className="my-4">
        <button onClick={updateApiKey} className="px-3 py-1.5 border rounded shadow-sm hover:bg-gray-100 text-sm bg-white">
          Set API Key
        </button>
      </div>

      {/* mode selector */}
      <div className="flex items-center gap-4 my-2">
        <label className="font-medium">Mode:</label>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input type="radio" name="mode" value="learn" checked={mode === "learn"} onChange={toggleMode} />
          Learn
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input type="radio" name="mode" value="test" checked={mode === "test"} onChange={toggleMode} />
          Test
        </label>
      </div>

      {/* language selector */}
      <div className="language-selector mt-2">
        <label className="mr-2 font-medium" htmlFor="language">Language:</label>
        <select id="language" value={language} onChange={handleLanguageChange} className="p-1 border rounded">
          {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
      </div>

      {/* section buttons */}
      {Object.keys(sections).length ? (
        <>
          <p className="mt-4 font-medium">Select a section:</p>
          <div className="section-buttons flex flex-wrap gap-2 justify-center">
            {Object.keys(sections).map((sec) => (
              <button key={sec} className="section-btn" onClick={() => selectSection(sec)}>
                {sec}
              </button>
            ))}
          </div>
        </>
      ) : !isLoading && (
        <p className="mt-4 text-gray-500">Loading sections…</p>
      )}
    </div>
  );

  const renderGame = () => {
    const canGoNext = mode === "learn" ? true : showWords ? true : true;
    const total = activePhrases.length;

    return (
      <div className="game-screen w-full max-w-3xl">
        {/* top bar */}
        <div className="top-bar flex items-center gap-2 mb-2">
          <button className="home-btn" onClick={goHome} disabled={isLoading}>Home</button>
          <h2 className="truncate flex-1" title={currentSection || ""}>{currentSection}</h2>
          {/* random toggle */}
          <label className="text-sm flex items-center gap-1 mr-2">
            Random
            <input type="checkbox" checked={isRandomOrder} onChange={handleOrderToggle} />
          </label>
          {/* mode selector */}
          <select value={mode} onChange={toggleMode} className="border rounded text-sm px-1">
            <option value="learn">Learn</option>
            <option value="test">Test</option>
          </select>
        </div>

        {/* sentence display */}
        <div className="sentence-display flex items-center justify-center gap-2 min-h-[2em] text-lg md:text-xl">
          {mode === "learn" ? (
            <span>{current.words.join(" ")}</span>
          ) : (
            <span>{clicked.join(" ") || (showWords ? "" : <span className="text-gray-400"> </span>)}</span>
          )}
          {!isSpeaking && (
            <button className="repeat-btn"
              title="Play sentence"
              onClick={() => handleSpeak(current.words.join(" "), language, current.audioCache.fullSentence)}>
              🔊
            </button>
          )}
          {isSpeaking && <span title="Speaking…">📢</span>}
        </div>

        {/* controls (test mode only) */}
        {mode === "test" && (
          <div className="controls flex justify-center gap-2 mt-3">
            <button className="show-words-btn" onClick={reshuffleWords}>{showWords ? "Reshuffle" : "Show Words"}</button>
            {mode === "test" && langNeedsHint && current.hint && (
  <button
    className="hint-btn"
    onClick={() => setShowHint((v) => !v)}
    disabled={isLoading || isSpeaking}
  >
    {showHint ? "Hide Hint" : "Show Hint"}
  </button>
)}
          </div>
        )}

        {/* word tiles */}
        {mode === "test" ? (
          <div className="word-tiles-container relative h-60 md:h-72 w-full mx-auto border rounded overflow-hidden my-4 bg-gray-50">
            {shuffledWords.map((w, i) => (
              <WordTile key={`${w}-${i}-${shuffleVersion}`} word={w} hidden={!showWords || clicked.includes(w)} isCorrect={wordStatus[w]} onClick={handleWordClick} />
            ))}
            {!showWords && <div className="absolute inset-0 flex items-center justify-center text-gray-500">Click “Show Words” to begin.</div>}
          </div>
        ) : (
          <div className="h-12" />
        )}

        {/* translation & next */}
        <div className="translation-footer flex flex-col items-center gap-2 mt-4">
          <div className="flex items-center gap-2">
            <p className="text-lg text-center">{current.translation}</p>
            <button className="next-button" onClick={nextPhrase} disabled={!canGoNext || isLoading || isSpeaking}>Next Phrase</button>
          </div>
        </div>

        {(mode === "learn" && langNeedsHint && current.hint) ||
 (mode === "test" && showHint && current.hint) ? (
  <div className="hint-container w-full text-center mt-2 px-4">
    <p className="hint-text text-base italic text-gray-600">
      Hint: {current.hint}
    </p>
  </div>
) : null}

        {/* progress */}
        {total > 0 && <p className="text-xs text-gray-400 mt-4 text-center">Phrase {idx + 1} of {total} ({isRandomOrder ? "random" : "sequential"})</p>}
      </div>
    );
  };

  return (
    <div className="app container mx-auto p-4 flex flex-col items-center min-h-screen">
      <LoadingOverlay isLoading={isLoading} message={loadingMsg} />
      <div className="flex-grow w-full flex flex-col items-center">
        {!isLoading && (currentSection === null ? renderHome() : renderGame())}
        {isLoading && <div className="pt-10">Loading...</div>}
      </div>
    </div>
  );
}
