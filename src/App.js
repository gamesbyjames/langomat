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
      audioCache: {},
    });
  });

  Object.keys(sections).forEach((s) => (sections[s] = shuffleArray(sections[s])));
  return sections;
}

// ──────────── TTS helpers ──────────── //
async function generateSpeech(text, language = "en-US") {
  const voiceId = VOICE_IDS[language] || VOICE_IDS["en-US"];
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
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error("generateSpeech", err);
    return null;
  }
}

function fallbackSpeak(text, lang = "en-US", rate = 0.8) {
  return new Promise((resolve, reject) => {
    const ut = new SpeechSynthesisUtterance(text);
    ut.lang = lang;
    ut.rate = rate;
    const voices = window.speechSynthesis.getVoices();
    const v =
      voices.find((vo) => vo.lang === lang) ||
      voices.find((vo) => vo.lang.startsWith(lang.split("-")[0]));
    if (v) ut.voice = v;
    ut.onend = resolve;
    ut.onerror = reject;
    window.speechSynthesis.speak(ut);
  });
}

async function speak(text, language = "en-US", cachedUrl = null) {
  try {
    const url = cachedUrl || (await generateSpeech(text, language));
    if (url) {
      await new Promise((res, rej) => {
        const audio = new Audio(url);
        audio.onended = res;
        audio.onerror = rej;
        audio.play().catch(rej);
      });
      return url;
    }
    await fallbackSpeak(text, language);
    return null;
  } catch (err) {
    console.error("speak", err);
    try { await fallbackSpeak(text, language); } catch (_) {}
    return null;
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
  const [language, setLanguage] = useState("en-US");
  const [sections, setSections] = useState({});
  const [currentSection, setCurrentSection] = useState(null);
  const [idx, setIdx] = useState(0);

  const [shuffled, setShuffled] = useState([]);
  const [shuffleVersion, setShuffleVersion] = useState(0);
  const [clicked, setClicked] = useState([]);
  const [wordStatus, setWordStatus] = useState({});
  const [showWords, setShowWords] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const [loadingMsg, setLoadingMsg] = useState("Loading...");
  const [isLoading, setIsLoading] = useState(true);

  const phrases = currentSection ? sections[currentSection] || [] : [];
  const current = phrases[idx] || { words: [], translation: "", hint: null, audioCache: {} };
  const langNeedsHint = HINT_LANGS.some((l) => language.startsWith(l));

  // Load file whenever language changes
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const fileMap = {
        "de-DE": "german_phrases.txt",
        "tr-TR": "phrases.txt",
        "fr-FR": "french_phrases.txt",
        "es-ES": "spanish_phrases.txt",
        "po-PO": "portuguese_phrases.txt",
        "it-IT": "italian_phrases.txt",
        "el-GR": "greek_phrases.txt",
      };
      const fileName = fileMap[language] || "german_phrases.txt";
      const data = await loadPhrasesFromFile(`${process.env.PUBLIC_URL}/${fileName}`);
      setSections(data);
      setCurrentSection(null);
      setIdx(0);
      setIsLoading(false);
    })();
  }, [language]);

  // reset UI when phrase changes
  useEffect(() => {
    if (current.words.length) {
      setShuffled(shuffleArray(current.words));
      setShuffleVersion((v) => v + 1);
      setClicked([]);
      setWordStatus({});
      setShowWords(false);
      setShowHint(false);
    }
  }, [idx, current.words]);

  const handleWordClick = async (word) => {
    if (!showWords || isSpeaking || isLoading) return;
    const expected = current.words[clicked.length];
    if (word === expected) {
      setWordStatus((prev) => ({ ...prev, [word]: true }));
      const newArr = [...clicked, word];
      setClicked(newArr);
      if (newArr.length === current.words.length) {
        setIsSpeaking(true);
        await speak(current.words.join(" "), language, current.audioCache.fullSentence);
        setIsSpeaking(false);
      }
    } else {
      setWordStatus((prev) => ({ ...prev, [word]: false }));
    }
  };

  const repeatSentence = async () => {
    if (clicked.length !== current.words.length) return;
    setIsSpeaking(true);
    await speak(current.words.join(" "), language, current.audioCache.fullSentence);
    setIsSpeaking(false);
  };

  const reshuffleWords = () => {
    setShuffled(shuffleArray(current.words));
    setShuffleVersion((v) => v + 1);
    if (!showWords) setShowWords(true);
  };

  const nextPhrase = () => {
    if (!phrases.length) return;
    let newIdx = Math.floor(Math.random() * phrases.length);
    while (newIdx === idx && phrases.length > 1) {
      newIdx = Math.floor(Math.random() * phrases.length);
    }
    setIdx(newIdx);
  };

  const goHome = () => {
    setCurrentSection(null);
    setIdx(0);
    setClicked([]);
  };

  // ─────────── render helpers ─────────── //
  const renderHome = () => (
    <div className="home-screen">
      <h1>Learn {LANGUAGE_NAMES[language]} Game</h1>
      <div className="language-selector">
        <label htmlFor="language" className="mr-2">Language:</label>
        <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {Object.keys(LANGUAGE_NAMES).map((code) => (
            <option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>
          ))}
        </select>
      </div>
      <p className="mt-4">Select a section:</p>
      <div className="section-buttons">
        {Object.keys(sections).map((sec) => (
          <button key={sec} className="section-btn" onClick={() => setCurrentSection(sec)}>
            {sec}
          </button>
        ))}
      </div>
    </div>
  );

  const renderGame = () => (
    <div className="game-screen">
      {/* Top Bar */}
      <div className="top-bar">
        <button className="home-btn" onClick={goHome}>Home</button>
        <h2>{currentSection}</h2>
      </div>

      {/* Sentence Display */}
      <div className="sentence-display flex items-center gap-2">
        {clicked.join(" ")}
        {clicked.length === current.words.length && (
          <button
            className="repeat-btn"
            title="Repeat"
            onClick={repeatSentence}
            disabled={isSpeaking}
          >
            🔊
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="controls flex gap-2 mt-3">
        <button className="show-words-btn" onClick={reshuffleWords}>
          {showWords ? "Reshuffle" : "Show Words"}
        </button>
        {langNeedsHint && (
          <button className="hint-btn" onClick={() => setShowHint((v) => !v)}>
            {showHint ? "Hide Hint" : "Hint"} {/* Optional: Change button text */}
          </button>
        )}
      </div>

      {/* Word Tiles */}
      <div className="word-tiles-container">
        {shuffled.map((w) => (
          <WordTile
            key={`${w}-${shuffleVersion}`}
            word={w}
            hidden={!showWords || clicked.includes(w)}
            isCorrect={wordStatus[w]}
            onClick={handleWordClick}
          />
        ))}
      </div>

      {/* Translation and Next Button Section */}
      <div className="translation-footer flex flex-col items-center gap-2 mt-4">
        <div className="flex items-center gap-2">
          <p>{current.translation}</p>
          <button
            className="next-button"
            onClick={nextPhrase}
            disabled={clicked.length !== current.words.length && showWords}
          >
            Next
          </button>
        </div>
        {/* Hint is MOVED FROM HERE */}
      </div>

      {/* Hint Section - NEW LOCATION */}
      {/* Conditionally render the hint container below the translation/next button */}
      {showHint && (
        <div className="hint-container w-full text-center mt-2"> {/* Container for centering and spacing */}
          <p className="hint-text text-sm italic"> {/* Styling for the text itself */}
            Hint: {current.hint || "no hint available"}
          </p>
        </div>
      )}

      {/* Progress Indicator (might need position adjustment in CSS depending on desired final layout) */}
      <div className="progress-indicator mt-4">{phrases.length} phrases in this section</div>
    </div>
  );

  // ──────────── component output ──────────── //
  return (
    <div className="app">
      <LoadingOverlay isLoading={isLoading} message={loadingMsg} />
      {!isLoading && (currentSection === null ? renderHome() : renderGame())}
    </div>
  );
}
