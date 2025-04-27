import React, { useState, useEffect, useCallback } from 'react'; // Added useCallback
import './App.css';

// --- Constants ---
const ELEVEN_LABS_API_KEY = "sk_39422d9d18ad0befa18c6c878b87decc036c716ebfc8d3dc"; // Replace with your actual API key
const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1";
const VOICE_IDS = {
  "tr-TR": "pNInz6obpgDQGcFmaJgB",
  "en-US": "21m00Tcm4TlvDq8ikWAM",
};
const PREFERRED_FALLBACK_VOICE_NAMES = [ // Prioritize these names in fallback
    'Natural', 'Siri', 'Alex', 'Samantha', 'Google', 'Microsoft David',
    'Microsoft Zira', 'Microsoft Mark', 'Microsoft Hazel', 'Microsoft Heera'
];

// --- Helper Functions ---
function shuffleArray(array) {
    // Fisher-Yates shuffle (implementation unchanged)
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

async function loadPhrasesFromFile(url) {
    // Implementation unchanged
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load phrases: ${response.status}`);
        const text = await response.text();
        const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('//'));
        return lines.map(line => {
            const [turkishPart, englishPart] = line.split('|').map(part => part.trim());
            return {
                words: turkishPart.split(' ').filter(word => word.trim()),
                translation: englishPart,
                audioCache: {},
            };
        });
    } catch (error) {
        console.error("Error loading phrases:", error);
        return [
            { words: ["Merhaba", "nasılsın"], translation: "Hello, how are you?", audioCache: {} },
            { words: ["İyiyim", "teşekkürler"], translation: "I'm fine, thank you", audioCache: {} },
        ];
    }
}

// --- ElevenLabs API Function ---
async function generateSpeech(text, language = 'tr-TR', stability = 0.5, similarity = 0.75) {
    // Implementation unchanged
    const voiceId = VOICE_IDS[language] || VOICE_IDS["en-US"];
    try {
        const response = await fetch(`${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVEN_LABS_API_KEY },
            body: JSON.stringify({
                text: text, model_id: "eleven_multilingual_v2",
                voice_settings: { stability, similarity_boost: similarity, style: 0.0, use_speaker_boost: true }
            }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error("ElevenLabs API error:", errorData);
            throw new Error(`ElevenLabs API error: ${response.status}`);
        }
        const audioBlob = await response.blob();
        return URL.createObjectURL(audioBlob);
    } catch (error) {
        console.error("Error generating speech:", error);
        return null;
    }
}


// --- Optimized Fallback TTS using Web Speech API ---
function fallbackSpeak(text, lang = 'tr-TR', rate = 0.8, voices = []) { // Added 'voices' parameter
    return new Promise((resolve, reject) => {
        if (!('speechSynthesis' in window)) {
            return reject(new Error("Speech Synthesis not supported by this browser."));
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = rate;
        utterance.pitch = 1.0;
        utterance.volume = 1;

        // --- Improved Voice Selection Logic ---
        let selectedVoice = null;
        const baseLang = lang.split('-')[0];

        if (voices.length > 0) {
            // 1. Try exact language match + prioritizing known good names or defaults
            const languageSpecificVoices = voices.filter(v => v.lang === lang);
            selectedVoice = languageSpecificVoices.find(v => PREFERRED_FALLBACK_VOICE_NAMES.some(name => v.name.includes(name)));
            if (!selectedVoice) selectedVoice = languageSpecificVoices.find(v => v.default);
            if (!selectedVoice && languageSpecificVoices.length > 0) selectedVoice = languageSpecificVoices[0];

            // 2. Fallback: Try matching the base language
            if (!selectedVoice) {
                const baseLangVoices = voices.filter(v => v.lang.startsWith(baseLang));
                selectedVoice = baseLangVoices.find(v => PREFERRED_FALLBACK_VOICE_NAMES.some(name => v.name.includes(name)));
                 if (!selectedVoice) selectedVoice = baseLangVoices.find(v => v.default);
                 if (!selectedVoice && baseLangVoices.length > 0) selectedVoice = baseLangVoices[0];
            }
        }
        // --- End of Improved Selection ---

        if (selectedVoice) {
            console.log("Using fallback voice:", selectedVoice.name, `(${selectedVoice.lang})`);
            utterance.voice = selectedVoice;
        } else {
            console.warn(`No suitable fallback voice found for lang: ${lang}. Using browser default.`);
            // Allow the browser to use its default for the specified lang if possible
        }

        utterance.onend = () => resolve();
        utterance.onerror = (error) => {
            console.error("SpeechSynthesis Error:", error);
            reject(error);
        };

        // Small delay sometimes helps prevent errors on immediate speak after cancel
        setTimeout(() => {
           window.speechSynthesis.speak(utterance);
        }, 50);
    });
}

// --- Enhanced speak function ---
// Now takes 'voices' array to pass to fallbackSpeak
async function speak(text, language = 'tr-TR', audioUrl = null, rate = 0.8, voices = [], useExternalTTS = true) {
    try {
        if (audioUrl) {
            // Play cached audio
            const audio = new Audio(audioUrl);
            await new Promise((resolve, reject) => {
                audio.onended = resolve;
                audio.onerror = reject;
                audio.play().catch(reject);
            });
            return audioUrl;
        } else if (useExternalTTS && ELEVEN_LABS_API_KEY && ELEVEN_LABS_API_KEY !== "YOUR_API_KEY_HERE") { // Check if API key is set
            // Try generating with ElevenLabs
            console.log(`Trying ElevenLabs for: "${text}" (${language})`);
            const url = await generateSpeech(text, language);
            if (url) {
                const audio = new Audio(url);
                await new Promise((resolve, reject) => {
                    audio.onended = resolve;
                    audio.onerror = reject;
                    audio.play().catch(reject);
                });
                return url; // Return generated URL for caching
            } else {
                console.warn("ElevenLabs failed, falling back to Web Speech API.");
                // Fall through to fallback if ElevenLabs fails
            }
        }

        // Fallback to Web Speech API
        console.log(`Using Web Speech API fallback for: "${text}" (${language})`);
        await fallbackSpeak(text, language, rate, voices); // Pass voices here
        return null; // No URL to cache for fallback

    } catch (error) {
        console.error("Speech playback error:", error);
        // Try web speech as last resort if any error occurred above
        try {
            console.warn("Attempting Web Speech API again after error.");
            await fallbackSpeak(text, language, rate, voices); // Pass voices here too
        } catch (secondError) {
            console.error("Fallback speech failed too:", secondError);
        }
        return null;
    }
}

// --- Components (WordTile, PronunciationGuide, LoadingIndicator - Unchanged) ---
function WordTile({ word, onClick, hidden, isCorrect }) {
  const [randomPos] = useState({ top: Math.random() * 70 + 5, left: Math.random() * 70 + 5 });
  const tileClass = `word-tile ${isCorrect === true ? 'correct' : isCorrect === false ? 'incorrect' : ''}`;
  return (
    <div className={tileClass} onClick={() => !hidden && onClick(word)} style={{ top: `${randomPos.top}%`, left: `${randomPos.left}%`, display: hidden ? "none" : "block" }}>
      {word}
    </div>
  );
}

function PronunciationGuide({ word, visible, onPlayPronunciation, audioUrl }) {
  // Simplified - could show word + button
  if (!visible) return null;
  return (
    <div className="pronunciation-guide">
      <p>Hear again:</p>
      <button onClick={() => onPlayPronunciation(word, audioUrl)}>
        🔊 {word}
      </button>
    </div>
  );
}

function LoadingIndicator({ isLoading, message = "Loading..." }) {
  if (!isLoading) return null;
  return (
    <div className="loading-overlay">
      <div className="loading-spinner"></div>
      <p>{message}</p>
    </div>
  );
}

// --- Main Game Component ---
function App() {
    // State Variables
    const [phrases, setPhrases] = useState([]);
    const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
    const [shuffledWords, setShuffledWords] = useState([]);
    const [clickedSequence, setClickedSequence] = useState([]);
    const [showFullSentence, setShowFullSentence] = useState(false);
    const [wordStatus, setWordStatus] = useState({}); // { [word]: true/false }
    const [showPronunciation, setShowPronunciation] = useState(false);
    const [currentWord, setCurrentWord] = useState("");
    const [currentWordAudio, setCurrentWordAudio] = useState(null); // Store cached URL for the *specific* word being shown
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState("Initializing...");
    const [useElevenLabs, setUseElevenLabs] = useState(true); // Default to trying ElevenLabs
    const [speechRate, setSpeechRate] = useState(0.9); // Default rate for fallback
    const [selectedLanguage, setSelectedLanguage] = useState('tr-TR');
    const [availableVoices, setAvailableVoices] = useState([]); // <--- State for voices

    const currentPhrase = phrases[currentPhraseIndex] || { words: [], translation: "", audioCache: {} };

    // Effect: Load Phrases from File
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            setLoadingMessage("Loading phrases...");
            const loadedPhrases = await loadPhrasesFromFile('phrases.txt');
            setPhrases(loadedPhrases);
            setIsLoading(false);
        };
        loadData();
    }, []); // Run only once on mount

    // Effect: Fetch available Speech Synthesis Voices
    useEffect(() => {
        const updateVoiceList = () => {
            if ('speechSynthesis' in window) {
                const voices = window.speechSynthesis.getVoices();
                setAvailableVoices(voices);
                console.log("System voices loaded:", voices.length);
            } else {
                console.warn("Speech Synthesis not supported.");
            }
        };

        // Voices might load asynchronously.
        updateVoiceList(); // Initial attempt
        if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = updateVoiceList;
        }

        // Cleanup listener
        return () => {
            if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
                window.speechSynthesis.onvoiceschanged = null;
            }
        };
    }, []); // Run only once on mount


    // Effect: Reset state when the current phrase changes
    useEffect(() => {
        if (phrases.length > 0 && currentPhrase.words.length > 0) {
            setShuffledWords(shuffleArray(currentPhrase.words));
            setClickedSequence([]);
            setShowFullSentence(false);
            setWordStatus({});
            setShowPronunciation(false);
            setCurrentWord("");
            setCurrentWordAudio(null);
            // Optionally preload audio here if not done elsewhere
        }
    }, [currentPhraseIndex, phrases]); // Depend on index and phrases array itself


    // Effect: Preload Audio (using useCallback for stability)
    const preloadAudioForPhrase = useCallback(async (phraseIndex) => {
        if (!useElevenLabs || phrases.length === 0 || !ELEVEN_LABS_API_KEY || ELEVEN_LABS_API_KEY === "YOUR_API_KEY_HERE") return;

        const phraseToLoad = phrases[phraseIndex];
        if (!phraseToLoad) return;

        let audioWasGenerated = false;
        const updatedCache = { ...phraseToLoad.audioCache };

        setIsLoading(true);
        setLoadingMessage("Preparing audio...");

        try {
            // Preload full sentence
            const fullText = phraseToLoad.words.join(" ");
            if (fullText && !updatedCache.fullSentence) {
                 console.log(`Preloading full: "${fullText}"`);
                const audioUrl = await generateSpeech(fullText, selectedLanguage);
                if (audioUrl) {
                    updatedCache.fullSentence = audioUrl;
                    audioWasGenerated = true;
                }
            }

            // Preload individual words (can be slow, consider doing it lazily on click if needed)
            for (const word of phraseToLoad.words) {
                if (word && !updatedCache[word]) {
                     console.log(`Preloading word: "${word}"`);
                    const audioUrl = await generateSpeech(word, selectedLanguage);
                    if (audioUrl) {
                        updatedCache[word] = audioUrl;
                        audioWasGenerated = true;
                    }
                }
            }

            if (audioWasGenerated) {
                // Update state immutably ONLY if cache changed
                setPhrases(prevPhrases => {
                    const newPhrases = [...prevPhrases];
                    if(newPhrases[phraseIndex]) {
                       newPhrases[phraseIndex] = { ...newPhrases[phraseIndex], audioCache: updatedCache };
                    }
                    return newPhrases;
                });
            }
        } catch (error) {
            console.error("Error preloading audio:", error);
        } finally {
            setIsLoading(false);
        }
    }, [phrases, useElevenLabs, selectedLanguage]); // Dependencies for useCallback

    // Trigger preload when index changes
     useEffect(() => {
        preloadAudioForPhrase(currentPhraseIndex);
    }, [currentPhraseIndex, preloadAudioForPhrase]); // Depend on index and the memoized preload function


    // --- Event Handlers (using useCallback where appropriate) ---

    const handleSpeak = useCallback(async (text, lang, cachedUrl = null) => {
        if (isSpeaking) return null; // Prevent concurrent speech
        setIsSpeaking(true);
        let generatedUrl = null;
        try {
            // Pass availableVoices and useElevenLabs setting to the speak function
            generatedUrl = await speak(text, lang, cachedUrl, speechRate, availableVoices, useElevenLabs);
        } catch (error) {
            console.error(`Error in handleSpeak for "${text}":`, error);
        } finally {
            setIsSpeaking(false);
        }
        return generatedUrl; // Return URL if one was generated/used
    }, [isSpeaking, speechRate, availableVoices, useElevenLabs]); // Dependencies for useCallback

    const playWordPronunciation = useCallback(async (word, cachedAudioUrl = null) => {
        const audioUrl = cachedAudioUrl || currentPhrase.audioCache[word];
        const generatedUrl = await handleSpeak(word, selectedLanguage, audioUrl);

        // If new audio was generated by ElevenLabs, update cache
        if (generatedUrl && !audioUrl && useElevenLabs) {
            setPhrases(prevPhrases => {
                const newPhrases = [...prevPhrases];
                const phrase = newPhrases[currentPhraseIndex];
                if (phrase && !phrase.audioCache[word]) {
                    phrase.audioCache = { ...phrase.audioCache, [word]: generatedUrl };
                }
                return newPhrases;
            });
            // If this is the currently displayed word, update its audio URL state
            if (word === currentWord) {
                 setCurrentWordAudio(generatedUrl);
            }
        } else if (word === currentWord) {
            // Ensure currentWordAudio reflects the URL used (even if from cache or fallback)
             setCurrentWordAudio(audioUrl || null); // null if fallback was used
        }
    }, [handleSpeak, selectedLanguage, currentPhrase, currentPhraseIndex, useElevenLabs, currentWord]);


    const handleWordClick = useCallback(async (clickedWord) => {
        if (isSpeaking || isLoading) return;

        setCurrentWord(clickedWord);
        setShowPronunciation(true);

        // Get cached URL *before* playing, playWordPronunciation might update it
        const cachedUrl = currentPhrase.audioCache[clickedWord];
        await playWordPronunciation(clickedWord, cachedUrl); // Play immediately

        const expectedWord = currentPhrase.words[clickedSequence.length];

        if (clickedWord === expectedWord) {
            setWordStatus(prev => ({ ...prev, [clickedWord]: true }));
            const newSequence = [...clickedSequence, clickedWord];
            setClickedSequence(newSequence);

            if (newSequence.length === currentPhrase.words.length) {
                // Correct sequence complete - play full sentence after a short delay
                setTimeout(async () => {
                    const fullText = currentPhrase.words.join(" ");
                    await handleSpeak(fullText, selectedLanguage, currentPhrase.audioCache.fullSentence);
                }, 500); // Delay before playing full sentence
            }
        } else {
            // Incorrect word
            setWordStatus(prev => ({ ...prev, [clickedWord]: false }));
            setShowFullSentence(true); // Show correct sentence

            // Play the correct word the user *should* have clicked
            const correctWordAudio = currentPhrase.audioCache[expectedWord];
            await playWordPronunciation(expectedWord, correctWordAudio);


            // Reset after a delay
            setTimeout(() => {
                setClickedSequence([]);
                setShowFullSentence(false);
                setWordStatus({});
                setShowPronunciation(false); // Hide pronunciation guide on reset
                setCurrentWord("");
                setCurrentWordAudio(null);
            }, 2500); // Longer delay after mistake
        }
    }, [isSpeaking, isLoading, currentPhrase, clickedSequence, playWordPronunciation, handleSpeak, selectedLanguage]);

    const handleNext = useCallback(() => {
        if (phrases.length > 0) {
            setCurrentPhraseIndex((prev) => (prev + 1) % phrases.length);
            // State resets are now handled by the useEffect watching currentPhraseIndex
        }
    }, [phrases.length]);

    const handleReplay = useCallback(async () => {
        if (clickedSequence.length > 0) {
            const text = clickedSequence.join(" ");
             // Try finding cached audio for this specific sequence (less likely unless pre-generated)
            // const sequenceKey = `sequence_${clickedSequence.join("_")}`;
            // const cachedSequenceAudio = currentPhrase.audioCache[sequenceKey];
            await handleSpeak(text, selectedLanguage, null); // Don't assume sequence is cached
        }
    }, [clickedSequence, handleSpeak, selectedLanguage]);

    const handleSpeakTranslation = useCallback(() => {
        if (currentPhrase.translation) {
            handleSpeak(currentPhrase.translation, 'en-US'); // Assuming translation is always English
        }
    }, [currentPhrase.translation, handleSpeak]);


    // --- Render Logic ---

    if (phrases.length === 0 && isLoading) {
        return (
            <div className="app">
                <h1>Language Learning Game</h1>
                <LoadingIndicator isLoading={true} message={loadingMessage} />
            </div>
        );
    }
     if (phrases.length === 0 && !isLoading) {
         return (
            <div className="app">
                <h1>Language Learning Game</h1>
                <p>Error: No phrases were loaded. Please check 'phrases.txt' and ensure it's accessible.</p>
            </div>
         );
    }


    const wordsToDisplay = shuffledWords.map((word, index) => {
        const isClickedCorrectly = clickedSequence.includes(word);
        // Use wordStatus for visual feedback (correct/incorrect flash)
        const status = wordStatus[word]; // true (correct), false (incorrect), undefined (not clicked yet or reset)
        return (
            <WordTile
                key={`${currentPhraseIndex}-${word}-${index}`} // More robust key
                word={word}
                onClick={handleWordClick}
                hidden={isClickedCorrectly} // Hide only if correctly part of the sequence
                isCorrect={status}
            />
        );
    });

    const isComplete = clickedSequence.length === currentPhrase.words.length;

    return (
        <div className="app">
            <h1>Learn Turkish Game</h1>
             {/* Add TTS Toggle for debugging/preference */}
             {/* <div style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(255,255,255,0.8)', padding: '5px', borderRadius: '5px' }}>
                <label>
                    <input type="checkbox" checked={useElevenLabs} onChange={() => setUseElevenLabs(!useElevenLabs)} disabled={!ELEVEN_LABS_API_KEY || ELEVEN_LABS_API_KEY === "YOUR_API_KEY_HERE"}/>
                    Use Premium TTS
                </label>
             </div> */}


            <LoadingIndicator isLoading={isLoading && !isSpeaking} message={loadingMessage} />

            <PronunciationGuide
                word={currentWord}
                visible={showPronunciation && !!currentWord && !isSpeaking}
                onPlayPronunciation={playWordPronunciation}
                audioUrl={currentWordAudio}
            />

            <div className="sentence-display">
                {/* Display full sentence on error, otherwise the sequence being built */}
                {showFullSentence ? (
                    <span className="correct-sentence">{currentPhrase.words.join(" ")}</span>
                ) : (
                    clickedSequence.join(" ")
                )}

                {/* Replay button for partially built sequence */}
                {clickedSequence.length > 0 && !isComplete && !showFullSentence && !isSpeaking && (
                    <button className="replay-button" onClick={handleReplay} disabled={isSpeaking}>
                        🔊 Replay
                    </button>
                )}
            </div>

            <div className="word-tiles-container">
                {wordsToDisplay}
            </div>

            <div className="translation-footer">
                <p>{currentPhrase.translation}</p>
                <button
                    className="speak-translation-button"
                    onClick={handleSpeakTranslation}
                    disabled={isSpeaking || isLoading || !currentPhrase.translation}
                    title="Speak translation (English)"
                >
                    🔊
                </button>
            </div>

            {isComplete && !showFullSentence && (
                <button className="next-button" onClick={handleNext} disabled={isSpeaking || isLoading}>
                    Next Phrase
                </button>
            )}

            <div className="progress-indicator">
                Phrase {currentPhraseIndex + 1} of {phrases.length}
            </div>

        </div>
    );
}

export default App;