import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// ElevenLabs API configuration
const ELEVEN_LABS_API_KEY = "sk_39422d9d18ad0befa18c6c878b87decc036c716ebfc8d3dc"; // Replace with your actual API key
const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1";

// Voice IDs for different languages - replace these with actual voice IDs from your ElevenLabs account
const VOICE_IDS = {
  "tr-TR": "pNInz6obpgDQGcFmaJgB", // Example Turkish voice ID
  "en-US": "21m00Tcm4TlvDq8ikWAM", // Example English voice ID
  // Add more languages as needed
};

// Helper function to shuffle an array (Fisher-Yates shuffle)
function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Function to parse phrases from a text file
async function loadPhrasesFromFile(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load phrases: ${response.status}`);
    }
    
    const text = await response.text();
    const lines = text.split('\n').filter(line => 
      line.trim() && !line.startsWith('//') // Skip empty lines and comments
    );
    
    return lines.map(line => {
      const [turkishPart, englishPart] = line.split('|').map(part => part.trim());
      const words = turkishPart.split(' ').filter(word => word.trim());
      
      return {
        words: words,
        translation: englishPart,
        audioCache: {} // Will store cached audio for each word and the full phrase
      };
    });
  } catch (error) {
    console.error("Error loading phrases:", error);
    // Return some default phrases as fallback
    return [
      {
        words: ["Merhaba", "nasılsın"],
        translation: "Hello, how are you?",
        audioCache: {}
      },
      {
        words: ["İyiyim", "teşekkürler"],
        translation: "I'm fine, thank you",
        audioCache: {}
      }
    ];
  }
}

// Function to generate speech using ElevenLabs API
async function generateSpeech(text, language = 'tr-TR', stability = 0.5, similarity = 0.75) {
  // Determine which voice ID to use based on language
  const voiceId = VOICE_IDS[language] || VOICE_IDS["en-US"]; // Default to English if language not found
  
  try {
    const response = await fetch(`${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVEN_LABS_API_KEY,
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2", // Use multilingual model for better language support
        voice_settings: {
          stability: stability,
          similarity_boost: similarity,
          style: 0.0, // Neutral style
          use_speaker_boost: true, // Improve clarity
        }
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error("ElevenLabs API error:", errorData);
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }
    
    // Get audio blob from response
    const audioBlob = await response.blob();
    return URL.createObjectURL(audioBlob);
  } catch (error) {
    console.error("Error generating speech:", error);
    return null;
  }
}

// Fallback text-to-speech function using Web Speech API
function fallbackSpeak(text, lang = 'tr-TR', rate = 0.8) {
  return new Promise((resolve, reject) => {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.volume = 1;

    // Voice selection logic
    const voices = window.speechSynthesis.getVoices();
    let voice = voices.find(v => v.lang === lang);
    if (!voice) {
      voice = voices.find(v => v.lang.indexOf(lang.split('-')[0]) !== -1);
    }
    
    if (voice) {
      utterance.voice = voice;
    }
    
    utterance.onend = () => resolve();
    utterance.onerror = (error) => reject(error);
    
    window.speechSynthesis.speak(utterance);
  });
}

// Enhanced speak function that tries ElevenLabs first, then falls back to web speech API
async function speak(text, language = 'tr-TR', audioUrl = null, rate = 0.8) {
  try {
    if (audioUrl) {
      // If we already have a cached audio URL, use it
      const audio = new Audio(audioUrl);
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
      });
      return audioUrl; // Return the URL we used
    } else {
      // Try to generate speech with ElevenLabs
      const url = await generateSpeech(text, language);
      if (url) {
        const audio = new Audio(url);
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = reject;
          audio.play().catch(reject);
        });
        return url; // Return the generated URL for caching
      } else {
        // Fall back to web speech API
        await fallbackSpeak(text, language, rate);
        return null; // No URL to cache
      }
    }
  } catch (error) {
    console.error("Speech playback error:", error);
    // Try web speech as last resort
    try {
      await fallbackSpeak(text, language, rate);
    } catch (secondError) {
      console.error("Fallback speech failed too:", secondError);
    }
    return null;
  }
}

// Component for individual word tiles
function WordTile({ word, onClick, hidden, isCorrect }) {
  const [randomPos] = useState({
    top: Math.random() * 70 + 5,   // Stay within 5-75% of container height
    left: Math.random() * 70 + 5,  // Stay within 5-75% of container width
  });

  const tileClass = `word-tile ${isCorrect === true ? 'correct' : isCorrect === false ? 'incorrect' : ''}`;

  return (
    <div 
      className={tileClass}
      onClick={() => !hidden && onClick(word)}
      style={{
        top: `${randomPos.top}%`,
        left: `${randomPos.left}%`,
        display: hidden ? "none" : "block",
      }}
    >
      {word}
    </div>
  );
}

// Pronunciation feedback component
function PronunciationGuide({ word, visible, onPlayPronunciation, audioUrl }) {
  return null;
  if (!visible) return null;
  
  return (
    <div className="pronunciation-guide">
      <p>Click to hear again</p>
      <button onClick={() => onPlayPronunciation(word, audioUrl)}>
        🔊 {word}
      </button>
    </div>
  );
}

// Loading indicator component
function LoadingIndicator({ isLoading, message = "Loading audio..." }) {
  if (!isLoading) return null;
  
  return (
    <div className="loading-overlay">
      <div className="loading-spinner"></div>
      <p>{message}</p>
    </div>
  );
}

// Main game component
function App() {
  const [phrases, setPhrases] = useState([]);
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
  const [shuffledWords, setShuffledWords] = useState([]);
  const [clickedSequence, setClickedSequence] = useState([]);
  const [showFullSentence, setShowFullSentence] = useState(false);
  const [wordStatus, setWordStatus] = useState({});
  const [showPronunciation, setShowPronunciation] = useState(false);
  const [currentWord, setCurrentWord] = useState("");
  const [currentWordAudio, setCurrentWordAudio] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading phrases...");
  const [useElevenLabs, setUseElevenLabs] = useState(true);
  const [speechRate, setSpeechRate] = useState(0.8);
  const [selectedLanguage, setSelectedLanguage] = useState('tr-TR');
  
  // Get the current phrase or return a placeholder if not loaded yet
  const currentPhrase = phrases[currentPhraseIndex] || { words: [], translation: "", audioCache: {} };

  // Load phrases from file on component mount
  useEffect(() => {
    const loadPhrases = async () => {
      setIsLoading(true);
      setLoadingMessage("Loading phrases...");
      
      try {
        // Replace 'phrases.txt' with the path to your phrases file
        const loadedPhrases = await loadPhrasesFromFile('phrases.txt');
        setPhrases(loadedPhrases);
      } catch (error) {
        console.error("Failed to load phrases:", error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadPhrases();
  }, []);

  // Only reset when the selected language changes (if required)
useEffect(() => {
  setCurrentPhraseIndex(0);
}, [selectedLanguage]);

  // Preload audio for current phrase
  useEffect(() => {
    let isMounted = true;
    
    const preloadAudio = async () => {
      if (!useElevenLabs || phrases.length === 0) return;
      
      setIsLoading(true);
      setLoadingMessage("Preparing audio...");
      
      try {
        const updatedPhrases = [...phrases];
        const phrase = updatedPhrases[currentPhraseIndex];
        
        // Generate audio for the full sentence if not already cached
        if (!phrase.audioCache.fullSentence) {
          const fullText = phrase.words.join(" ");
          const audioUrl = await generateSpeech(fullText, selectedLanguage);
          if (audioUrl && isMounted) {
            phrase.audioCache.fullSentence = audioUrl;
          }
        }
        
        // Pre-generate audio for each word (in background)
        for (const word of phrase.words) {
          if (!phrase.audioCache[word]) {
            const audioUrl = await generateSpeech(word, selectedLanguage);
            if (audioUrl && isMounted) {
              phrase.audioCache[word] = audioUrl;
            }
          }
        }
        
        if (isMounted) {
          setPhrases(updatedPhrases);
        }
      } catch (error) {
        console.error("Error preloading audio:", error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    
    preloadAudio();
    
    return () => {
      isMounted = false;
    };
  }, [currentPhraseIndex, useElevenLabs, phrases, selectedLanguage]);

  // Every time a new phrase is loaded or phrases change, shuffle words and reset state
  useEffect(() => {
    if (phrases.length > 0) {
      setShuffledWords(shuffleArray(currentPhrase.words));
      setClickedSequence([]);
      setShowFullSentence(false);
      setWordStatus({});
      setShowPronunciation(false);
      setCurrentWord("");
      setCurrentWordAudio(null);
    }
  }, [currentPhrase, phrases.length]);

  // Handle playing a word's pronunciation
  const playWordPronunciation = async (word, existingAudioUrl = null) => {
    if (isSpeaking || phrases.length === 0) return;
    
    setIsSpeaking(true);
    
    try {
      // Use cached audio if available
      const cachedAudio = existingAudioUrl || currentPhrase.audioCache[word];
      const audioUrl = await speak(word, selectedLanguage, cachedAudio);
      
      // Cache the audio URL if it's new
      if (audioUrl && !currentPhrase.audioCache[word]) {
        const updatedPhrases = [...phrases];
        updatedPhrases[currentPhraseIndex].audioCache[word] = audioUrl;
        setPhrases(updatedPhrases);
      }
      
      if (word === currentWord) {
        setCurrentWordAudio(audioUrl);
      }
    } catch (error) {
      console.error("Error playing word pronunciation:", error);
    } finally {
      setIsSpeaking(false);
    }
  };

  // Handler for when a word is clicked
  const handleWordClick = async (clickedWord) => {
    if (isSpeaking || isLoading || phrases.length === 0) return; // Prevent interaction during speech or loading
    
    setCurrentWord(clickedWord);
    setShowPronunciation(true);
    
    // Play the clicked word's pronunciation
    await playWordPronunciation(clickedWord, currentPhrase.audioCache[clickedWord]);
    
    // Check if the clicked word is the next expected word
    const expectedWord = currentPhrase.words[clickedSequence.length];
    
    if (clickedWord === expectedWord) {
      // Update word status to show it was correct
      setWordStatus(prev => ({
        ...prev,
        [clickedWord]: true
      }));
      
      const newSequence = [...clickedSequence, clickedWord];
      setClickedSequence(newSequence);

      // If the complete sentence is assembled, speak the full sentence
      if (newSequence.length === currentPhrase.words.length) {
        setTimeout(async () => {
          setIsSpeaking(true);
          try {
            // Use the cached full sentence audio if available
            await speak(
              currentPhrase.words.join(" "), 
              selectedLanguage, 
              currentPhrase.audioCache.fullSentence
            );
          } catch (error) {
            console.error("Error playing full sentence:", error);
          } finally {
            setIsSpeaking(false);
          }
        }, 500);
      }
    } else {
      // Wrong selection: show the full sentence briefly and reset
      setWordStatus(prev => ({
        ...prev,
        [clickedWord]: false
      }));
      
      setShowFullSentence(true);
      
      // Speak the correct word the user should have selected
      await playWordPronunciation(expectedWord, currentPhrase.audioCache[expectedWord]);
      
      setTimeout(() => {
        setClickedSequence([]);
        setShowFullSentence(false);
        setWordStatus({});
      }, 2000);
    }
  };

  // Create display for each word; hide words that have been correctly clicked
  const wordsToDisplay = shuffledWords.map((word, index) => {
    const isClicked = clickedSequence.includes(word);
    return (
      <WordTile 
        key={`${word}-${index}`} 
        word={word} 
        onClick={handleWordClick} 
        hidden={isClicked}
        isCorrect={wordStatus[word]} 
      />
    );
  });

  // Handler for clicking the "Next" button
  const handleNext = () => {
    if (phrases.length > 0) {
      setCurrentPhraseIndex((prev) => {
        const newIndex = (prev + 1) % phrases.length;
        return newIndex;
      });
      // Reset states after index update
      setTimeout(() => {
        setClickedSequence([]);
        setShowFullSentence(false);
        setWordStatus({});
        setShowPronunciation(false);
        setCurrentWord("");
        setCurrentWordAudio(null);
      }, 0);
    }
  };

  // Handle replay of the current sequence
  const handleReplay = async () => {
    if (isSpeaking || isLoading || phrases.length === 0) return;
    
    setIsSpeaking(true);
    
    try {
      if (clickedSequence.length > 0) {
        const text = clickedSequence.join(" ");
        // Try to find cached audio for this exact sequence
        const audioKey = `sequence_${clickedSequence.join("_")}`;
        await speak(text, selectedLanguage, currentPhrase.audioCache[audioKey] || null);
      }
    } catch (error) {
      console.error("Speech replay error:", error);
    } finally {
      setIsSpeaking(false);
    }
  };

  // Toggle between ElevenLabs and browser TTS
  const toggleTTSProvider = () => {
    setUseElevenLabs(!useElevenLabs);
  };

  // Handle speech rate change (mostly for fallback TTS)
  const handleSpeedChange = (newRate) => {
    setSpeechRate(newRate);
  };

  // If phrases are still loading, show a loading screen
  if (phrases.length === 0) {
    return (
      <div className="app">
        <h1>Language Learning Game</h1>
        <LoadingIndicator isLoading={true} message="Loading phrases..." />
      </div>
    );
  }

  return (
    <div className="app">
      <h1>Learn Turkish Game</h1>      
      
      {/* Loading indicator */}
      <LoadingIndicator isLoading={isLoading} message={loadingMessage} />

      {/* Pronunciation guide */}
      <PronunciationGuide 
        word={currentWord} 
        visible={showPronunciation && currentWord && !isSpeaking} 
        onPlayPronunciation={playWordPronunciation}
        audioUrl={currentWordAudio}
      />

      {/* Display the current clicked sequence or the full sentence in case of an error */}
      <div className="sentence-display">
        {showFullSentence
          ? currentPhrase.words.join(" ")
          : clickedSequence.join(" ")}
          
        {clickedSequence.length > 0 && !showFullSentence && !isSpeaking && (
          <button className="replay-button" onClick={handleReplay}>
            🔊 Replay
          </button>
        )}
      </div>

      {/* Container for word tiles */}
      <div className="word-tiles-container">
        {wordsToDisplay}
      </div>

      {/* Translation displayed at the bottom */}
      <div className="translation-footer">
        <p>{currentPhrase.translation}</p>
        <button 
          className="speak-translation-button"
          onClick={() => speak(currentPhrase.translation, 'en-US')}
          disabled={isSpeaking || isLoading}
        >
          🔊
        </button>
      </div>

      {/* "Next" button appears only if the complete sentence has been correctly assembled */}
      {clickedSequence.length === currentPhrase.words.length && !showFullSentence && !isSpeaking && (
        <button className="next-button" onClick={handleNext}>
          Next
        </button>
      )}
      
      {/* Progress indicator */}
      <div className="progress-indicator">
        Phrase {currentPhraseIndex + 1} of {phrases.length}
      </div>
    </div>
  );
}



export default App;