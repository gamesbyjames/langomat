import React, { useState, useEffect } from 'react';
import './App.css';

// ElevenLabs API configuration
const ELEVEN_LABS_API_KEY = "sk_39422d9d18ad0befa18c6c878b87decc036c716ebfc8d3dc"; // Replace with your actual API key
const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1";

const VOICE_IDS = {
  'tr-TR': 'pNInz6obpgDQGcFmaJgB',
  'en-US': '21m00Tcm4TlvDq8ikWAM',
};

// ---------- helpers ---------- //
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
    const phrases = text
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('//'))
      .map((line) => {
        const [tr, en] = line.split('|').map((p) => p.trim());
        return {
          words: tr.split(' ').filter(Boolean),
          translation: en,
          audioCache: {},
        };
      });
    return shuffleArray(phrases); // shuffle the phrase order once at load
  } catch (err) {
    console.error('loadPhrasesFromFile', err);
    return [
      {
        words: ['Merhaba', 'nasılsın'],
        translation: 'Hello, how are you?',
        audioCache: {},
      },
    ];
  }
}

async function generateSpeech(text, language = 'tr-TR') {
  const voiceId = VOICE_IDS[language] || VOICE_IDS['en-US'];
  try {
    const res = await fetch(`${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVEN_LABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error('generateSpeech', err);
    return null;
  }
}

function fallbackSpeak(text, lang = 'tr-TR', rate = 0.8) {
  return new Promise((resolve, reject) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = rate;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang === lang) || voices.find((v) => v.lang.startsWith(lang.split('-')[0]));
    if (voice) utter.voice = voice;
    utter.onend = resolve;
    utter.onerror = reject;
    window.speechSynthesis.speak(utter);
  });
}

async function speak(text, language = 'tr-TR', cachedUrl = null) {
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
    console.error('speak', err);
    try {
      await fallbackSpeak(text, language);
    } catch (_) {}
    return null;
  }
}

// ---------- components ---------- //
function WordTile({ word, hidden, isCorrect, onClick }) {
  const [pos] = React.useState({ top: Math.random() * 70 + 5, left: Math.random() * 70 + 5 });
  if (hidden) return null;
  return (
    <div
      className={`word-tile ${isCorrect === true ? 'correct' : isCorrect === false ? 'incorrect' : ''}`}
      style={{ top: `${pos.top}%`, left: `${pos.left}%` }}
      onClick={() => onClick(word)}
    >
      {word}
    </div>
  );
}

const LoadingIndicator = ({ isLoading, message }) =>
  isLoading ? (
    <div className="loading-overlay">
      <div className="loading-spinner" />
      <p>{message}</p>
    </div>
  ) : null;

// ---------- main ---------- //
function App() {
  const [phrases, setPhrases] = useState([]);
  const [idx, setIdx] = useState(0);
  const [shuffled, setShuffled] = useState([]);
  const [clicked, setClicked] = useState([]);
  const [wordStatus, setWordStatus] = useState({});
  const [showWords, setShowWords] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Loading...');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const language = 'tr-TR';

  const current = phrases[idx] || { words: [], translation: '', audioCache: {} };

  // load phrases on mount
  useEffect(() => {
    (async () => {
      setLoadingMsg('Loading phrases...');
      const data = await loadPhrasesFromFile('phrases.txt');
      setPhrases(data);
      setIsLoading(false);
    })();
  }, []);

  // set shuffled when phrase changes
  useEffect(() => {
    if (current.words.length) {
      setShuffled(shuffleArray(current.words));
      setClicked([]);
      setWordStatus({});
      setShowWords(false);
    }
  }, [idx, current.words]);

  // ------------- handlers ------------- //
  const handleWordClick = async (word) => {
    if (!showWords || isSpeaking || isLoading) return;

    const cached = current.audioCache[word];
    setIsSpeaking(true);
    const url = await speak(word, language, cached);
    setIsSpeaking(false);
    if (url && !cached) {
      const updated = [...phrases];
      updated[idx].audioCache[word] = url;
      setPhrases(updated);
    }

    const expected = current.words[clicked.length];
    if (word === expected) {
      setWordStatus((prev) => ({ ...prev, [word]: true }));
      const newSeq = [...clicked, word];
      setClicked(newSeq);
      if (newSeq.length === current.words.length) {
        setIsSpeaking(true);
        await speak(current.words.join(' '), language, current.audioCache.fullSentence);
        setIsSpeaking(false);
      }
    } else {
      setWordStatus((prev) => ({ ...prev, [word]: false }));
    }
  };

  const nextPhrase = () => {
    if (!phrases.length) return;
    setIdx((prev) => {
      if (phrases.length === 1) return prev; // only one phrase
      let newIdx = Math.floor(Math.random() * phrases.length);
      while (newIdx === prev) {
        newIdx = Math.floor(Math.random() * phrases.length);
      }
      return newIdx;
    });
  };

  // ---------- render ---------- //
  if (!phrases.length) {
    return (
      <div className="app">
        <h1>Learn Turkish Game</h1>
        <LoadingIndicator isLoading message="Loading phrases..." />
      </div>
    );
  }

  return (
    <div className="app">
      <h1>Learn Turkish Game</h1>
      <LoadingIndicator isLoading={isLoading} message={loadingMsg} />

      <div className="sentence-display">{clicked.join(' ')}</div>

      {!showWords && (
        <button className="show-words-button" onClick={() => setShowWords(true)}>
          Show Words
        </button>
      )}

      <div className="word-tiles-container">
        {shuffled.map((w, i) => (
          <WordTile
            key={`${w}-${i}`}
            word={w}
            hidden={!showWords || clicked.includes(w)}
            isCorrect={wordStatus[w]}
            onClick={handleWordClick}
          />
        ))}
      </div>

      <div className="translation-footer">
        <p>{current.translation}</p>
        <button
          onClick={nextPhrase}
          disabled={clicked.length !== current.words.length && showWords}
          className="next-button"
        >
          Next
        </button>
      </div>

      <div className="progress-indicator">
        {/* idx here isn't meaningful because of randomness, so just show total count */}
        Random practice | {phrases.length} phrases loaded
      </div>
    </div>
  );
}

export default App;
