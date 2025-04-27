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
  "en-US": "21m00Tcm4TlvDq8ikWAM",
};

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
          words: ["Bonjour", "comment", "ça", "va"],
          translation: "Hello, how are you?",
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
    const [first, second] = line.split("|").map((p) => p.trim());
    if (!first || !second) return;
    sections[currentSection].push({
      words: first.split(" ").filter(Boolean),
      translation: second,
      audioCache: {},
    });
  });
  Object.keys(sections).forEach((s) => {
    sections[s] = shuffleArray(sections[s]);
  });
  return sections;
}

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

// ──────────── components ──────────── //
function LoadingOverlay({ isLoading, message }) {
  if (!isLoading) return null;
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 text-white z-50">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"></div>
      <p className="text-lg font-semibold">{message}</p>
    </div>
  );
}

function WordTile({ word, hidden, isCorrect, onClick }) {
  const [pos] = useState({ top: Math.random() * 70 + 5, left: Math.random() * 70 + 5 });
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

// ──────────── main ──────────── //
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

  const [loadingMsg, setLoadingMsg] = useState("Loading...");
  const [isLoading, setIsLoading] = useState(true);

  const phrases = currentSection ? sections[currentSection] || [] : [];
  const current = phrases[idx] || { words: [], translation: "", audioCache: {} };

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setLoadingMsg("Loading phrases...");
      let fileName;
      switch (language) {
        case "de-DE":
          fileName = "german_phrases.txt";
          break;
        case "tr-TR":
          fileName = "phrases.txt";
          break;
        case "fr-FR":
          fileName = "french_phrases.txt";
          break;
        default:
          fileName = "phrases.txt";
      }
      const data = await loadPhrasesFromFile(`${process.env.PUBLIC_URL}/${fileName}`);
      setSections(data);
      setCurrentSection(null);
      setIdx(0);
      setIsLoading(false);
    })();
  }, [language]);

  useEffect(() => {
    if (current.words.length) {
      setShuffled(shuffleArray(current.words));
      setShuffleVersion((v) => v + 1);
      setClicked([]);
      setWordStatus({});
      setShowWords(false);
    }
  }, [idx, current.words]);

  const handleWordClick = async (word) => {
    if (!showWords || isSpeaking || isLoading) return;
    const expected = current.words[clicked.length];
    if (word === expected) {
      setWordStatus((p) => ({ ...p, [word]: true }));
      const newSeq = [...clicked, word];
      setClicked(newSeq);
      if (newSeq.length === current.words.length) {
        const sentence = current.words.join(" ");
        setIsSpeaking(true);
        const url = await speak(sentence, language, current.audioCache.fullSentence);
        setIsSpeaking(false);
        if (url && !current.audioCache.fullSentence) {
          const copy = { ...sections };
          copy[currentSection][idx].audioCache.fullSentence = url;
          setSections(copy);
        }
      }
    } else {
      setWordStatus((p) => ({ ...p, [word]: false }));
    }
  };

  const repeatSentence = async () => {
    if (clicked.length !== current.words.length) return;
    const sentence = current.words.join(" ");
    setIsSpeaking(true);
    await speak(sentence, language, current.audioCache.fullSentence);
    setIsSpeaking(false);
  };

  const reshuffleWords = () => {
    setShuffled(shuffleArray(current.words));
    setShuffleVersion((v) => v + 1);
    if (!showWords) setShowWords(true);
  };

  const nextPhrase = () => {
    if (!phrases.length) return;
    setIdx((prev) => {
      let newIdx = Math.floor(Math.random() * phrases.length);
      while (newIdx === prev) newIdx = Math.floor(Math.random() * phrases.length);
      return newIdx;
    });
  };

  const goHome = () => {
    setCurrentSection(null);
    setIdx(0);
    setClicked([]);
  };

  const renderHome = () => (
    <div className="home-screen">
      <h1>Learn {language === "de-DE" ? "German" : language === "tr-TR" ? "Turkish" : "French"} Game</h1>
      <div className="language-selector">
        <label htmlFor="language" className="mr-2">Select Language:</label>
        <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="de-DE">German</option>
          <option value="tr-TR">Turkish</option>
          <option value="fr-FR">French</option>
        </select>
      </div>
      <p>Select a section:</p>
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
      <div className="top-bar">
        <button className="home-btn" onClick={goHome}>Home</button>
        <h2>{currentSection}</h2>
      </div>

      <div className="sentence-display flex items-center gap-2">
        {clicked.join(" ")} {" "}
        {clicked.length === current.words.length && (
          <button className="repeat-btn" title="Repeat" onClick={repeatSentence} disabled={isSpeaking}>
            🔊
          </button>
        )}
      </div>

      <button className="show-words-btn" onClick={reshuffleWords}>
        {showWords ? "Reshuffle" : "Show Words"}
      </button>

      <div className="word-tiles-container">
        {shuffled.map((w) => (
          <WordTile key={`${w}-${shuffleVersion}`} word={w} hidden={!showWords || clicked.includes(w)} isCorrect={wordStatus[w]} onClick={handleWordClick} />
        ))}
      </div>

      <div className="translation-footer">
        <p>{current.translation}</p>
        <button className="next-button" onClick={nextPhrase} disabled={clicked.length !== current.words.length && showWords}>
          Next
        </button>
      </div>

      <div className="progress-indicator">{phrases.length} phrases in this section</div>
    </div>
  );

  return (
    <div className="app">
      <LoadingOverlay isLoading={isLoading} message={loadingMsg} />
      {!isLoading && (currentSection === null ? renderHome() : renderGame())}
    </div>
  );
}
