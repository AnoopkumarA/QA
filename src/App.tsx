import { useState } from 'react'
import stringSimilarity from 'string-similarity'
import './App.css'

// Add Hugging Face API configuration
const HUGGING_FACE_API_URL = "https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat-hf";
const HUGGING_FACE_API_KEY = "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"; // Replace with your API key

// Add interface for Hugging Face API response
interface HuggingFaceResponse {
  generated_text: string;
}

interface Question {
  id: number;
  text: string;
  answer: string;
  keywords: string[];
}

interface Cache {
  [key: string]: {
    timestamp: number;
    data: any;
  };
}

// Add custom hook for text-to-speech
const useTextToSpeech = () => {
  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.cancel(); // Cancel any ongoing speech
    window.speechSynthesis.speak(utterance);
  };

  return { speak };
};

function App() {
  const [studyContent, setStudyContent] = useState<string>('');
  const [extractedQuestions, setExtractedQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [questions, setQuestions] = useState<string[]>([]);
  
  // Cache implementation
  const cache: Cache = {};
  const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

  // Cache utility functions
  const getCacheKey = (type: string, content: string): string => {
    return `${type}_${content.slice(0, 50)}`;
  };

  const setCache = (key: string, data: any) => {
    cache[key] = {
      timestamp: Date.now(),
      data: data
    };
  };

  const getCache = (key: string) => {
    const cached = cache[key];
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > CACHE_DURATION;
    if (isExpired) {
      delete cache[key];
      return null;
    }

    return cached.data;
  };

  // Enhanced keyword extraction
  const extractKeywords = (text: string): string[] => {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was', 'were']);
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => !stopWords.has(word) && word.length > 2);

    const wordFreq = words.reduce((acc: { [key: string]: number }, word) => {
      acc[word] = (acc[word] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(wordFreq)
      .sort(([a, freqA], [b, freqB]) => {
        if (freqA === freqB) return b.length - a.length;
        return freqB - freqA;
      })
      .slice(0, 5)
      .map(([word]) => word);
  };

  // Calculate similarity between sentences
  const calculateSimilarity = (text1: string, text2: string): number => {
    return stringSimilarity.compareTwoStrings(
      text1.toLowerCase(),
      text2.toLowerCase()
    );
  };

  // Modify the generateAbstractiveAnswer function
  const generateAbstractiveAnswer = async (question: string, context: string): Promise<string> => {
    try {
      const prompt = `
        Context: "${context}"
        Question: "${question}"
        
        Instructions:
        1. Analyze the context and question carefully
        2. Provide a comprehensive answer that:
           - Explains the main concepts
           - Adds relevant examples or analogies
           - Connects different ideas
           - Includes additional insights
           - Uses your own words to explain
        3. Make sure to:
           - Expand on the key points
           - Add explanatory details
           - Make complex ideas easier to understand
           - Include practical implications where relevant
        
        Please provide a detailed, well-structured answer:
      `;

      const response = await fetch(HUGGING_FACE_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HUGGING_FACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_length: 250,
            temperature: 0.8,
            top_p: 0.9,
            do_sample: true,
            top_k: 50,
            repetition_penalty: 1.2
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate abstractive answer');
      }

      const result: HuggingFaceResponse = await response.json();
      return result.generated_text;
    } catch (error) {
      console.error('Error generating abstractive answer:', error);
      return '';
    }
  };

  // Modify the generateAnswer function
  const generateAnswer = async (question: string, content: string): Promise<{ 
    text: string; 
    keywords: string[];
  }> => {
    const cacheKey = getCacheKey('answer', `${question}_${content.slice(0, 100)}`);
    const cached = getCache(cacheKey);
    if (cached) return cached;

    if (!content) {
      return { 
        text: 'No study content provided.',
        keywords: [] 
      };
    }

    try {
      // Extract relevant context
      const questionKeywords = extractKeywords(question);
      const paragraphs = content.split(/\n\s*\n/);
      const sentences = paragraphs.flatMap(p => 
        p.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20)
      );
      
      // Score and select relevant sentences
      const scoredSentences = sentences.map(sentence => {
        const sentenceKeywords = extractKeywords(sentence);
        const keywordOverlap = questionKeywords.filter(kw => 
          sentenceKeywords.includes(kw)
        ).length / questionKeywords.length;

        const similarityScore = calculateSimilarity(question, sentence);
        const contextScore = calculateContextRelevance(sentence, sentences);
        
        return {
          sentence,
          score: (keywordOverlap * 0.3) + (similarityScore * 0.5) + (contextScore * 0.2),
          keywords: sentenceKeywords
        };
      });

      scoredSentences.sort((a, b) => b.score - a.score);
      const bestMatches = scoredSentences.slice(0, 2);
      
      if (bestMatches[0].score > 0.3) {
        // Get relevant context
        const relevantContext = bestMatches
          .map(match => match.sentence)
          .join(' ');

        // Generate abstractive answer
        const abstractiveAnswer = await generateAbstractiveAnswer(
          question,
          relevantContext
        );

        // Structure the final answer
        const finalAnswer = abstractiveAnswer ? 
          formatAnswer(relevantContext, abstractiveAnswer) :
          relevantContext;

        const result = {
          text: finalAnswer,
          keywords: Array.from(new Set([
            ...questionKeywords,
            ...bestMatches[0].keywords
          ]))
        };

        setCache(cacheKey, result);
        return result;
      }

      return {
        text: 'No relevant answer found in the study content.',
        keywords: []
      };

    } catch (error) {
      console.error('Error in answer generation:', error);
      return {
        text: 'Error generating answer. Please try again.',
        keywords: []
      };
    }
  };

  // Add helper function to format the answer
  const formatAnswer = (context: string, aiGenerated: string): string => {
    const sections = [
      {
        title: "Key Information:",
        content: context
      },
      {
        title: "Detailed Explanation:",
        content: aiGenerated
      }
    ];

    return sections
      .filter(section => section.content.trim())
      .map(section => `${section.title}\n${section.content}`)
      .join('\n\n');
  };

  // Calculate context relevance
  const calculateContextRelevance = (sentence: string, allSentences: string[]): number => {
    const sentenceIndex = allSentences.indexOf(sentence);
    if (sentenceIndex === -1) return 0;

    const contextWindow = 2;
    const start = Math.max(0, sentenceIndex - contextWindow);
    const end = Math.min(allSentences.length, sentenceIndex + contextWindow + 1);
    
    const contextSentences = allSentences.slice(start, end);
    const contextKeywords = new Set(contextSentences.flatMap(extractKeywords));
    const sentenceKeywords = new Set(extractKeywords(sentence));

    const overlap = [...sentenceKeywords].filter(kw => contextKeywords.has(kw)).length;
    return overlap / sentenceKeywords.size || 0;
  };

  // Handle question paper upload
  const handleQuestionPaperUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLoading(true);
      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target?.result as string;
        const extractedQs = await extractQuestions(text);
        setQuestions(extractedQs);
        setLoading(false);
      };
      reader.readAsText(file);
    }
  };

  // Handle study content upload
  const handleStudyContentUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setStudyContent(text);
      };
      reader.readAsText(file);
    }
  };

  // Add new function to normalize text for comparison
  const normalizeText = (text: string): string => {
    return text.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\s]+/g, ' ')
      .trim();
  };

  // Add function to check similarity between questions
  const isSimilarQuestion = (q1: string, q2: string): boolean => {
    const normalized1 = normalizeText(q1);
    const normalized2 = normalizeText(q2);

    // Check exact match after normalization
    if (normalized1 === normalized2) return true;

    // Check similarity score
    const similarity = calculateSimilarity(normalized1, normalized2);
    return similarity > 0.8; // 80% similarity threshold
  };

  // Modified extractQuestions function to remove duplicates
  const extractQuestions = async (text: string): Promise<string[]> => {
    const paragraphs = text.split(/\n\s*\n/);
    const uniqueQuestions = new Set<string>();
    const questionPatterns = [
      /(?:\d+[\).]|\?)\s*([^\n?]+\?)/g,
      /([^.!?\n]+\?)/g,
      /(?:\d+\.|Q:)\s*([^\n]+)/g,
    ];

    for (const paragraph of paragraphs) {
      const potentialQuestions = new Set<string>();

      questionPatterns.forEach(pattern => {
        const matches = Array.from(paragraph.matchAll(pattern));
        matches.forEach(match => {
          if (match[1] && isValidQuestion(match[1].trim())) {
            const newQuestion = match[1].trim();
            
            // Check if similar question already exists
            const isDuplicate = Array.from(uniqueQuestions).some(existingQuestion => 
              isSimilarQuestion(existingQuestion, newQuestion)
            );

            if (!isDuplicate) {
              potentialQuestions.add(newQuestion);
            }
          }
        });
      });

      // Add non-duplicate questions
      for (const question of potentialQuestions) {
        uniqueQuestions.add(question);
      }
    }

    return Array.from(uniqueQuestions);
  };

  // Modified isValidQuestion to be more strict
  const isValidQuestion = (text: string): boolean => {
    const questionWords = ['who', 'what', 'when', 'where', 'why', 'how', 'is', 'are', 'can', 'could', 'should', 'would'];
    const hasQuestionWord = questionWords.some(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(text);
    });
    
    const endsWithQuestionMark = text.trim().endsWith('?');
    const minWords = text.split(/\s+/).length >= 3;
    const maxWords = text.split(/\s+/).length <= 50; // Add maximum length check
    
    return (hasQuestionWord || endsWithQuestionMark) && minWords && maxWords;
  };

  // Add function to group similar questions
  const groupSimilarQuestions = (questions: Question[]): Question[] => {
    const groups: Question[][] = [];
    
    questions.forEach(question => {
      const existingGroup = groups.find(group => 
        group.some(q => isSimilarQuestion(q.text, question.text))
      );

      if (existingGroup) {
        existingGroup.push(question);
      } else {
        groups.push([question]);
      }
    });

    return groups.map(group => group[0]);
  };

  // Modified handleGenerateAnswers function
  const handleGenerateAnswers = async () => {
    if (!studyContent) {
      alert('Please upload study content first!');
      return;
    }

    setLoading(true);
    const answeredQuestions: Question[] = [];
    let questionId = 1;

    for (let i = 0; i < questions.length; i += 5) {
      const batch = questions.slice(i, i + 5);
      const batchPromises = batch.map(async (questionText) => {
        const answer = await generateAnswer(questionText, studyContent);
        return {
          id: questionId++,
          text: questionText,
          answer: answer.text,
          keywords: answer.keywords
        };
      });

      const batchResults = await Promise.all(batchPromises);
      answeredQuestions.push(...batchResults);
    }

    const uniqueAnsweredQuestions = groupSimilarQuestions(answeredQuestions);
    
    const finalQuestions = uniqueAnsweredQuestions.map((q, index) => ({
      ...q,
      id: index + 1
    }));

    setExtractedQuestions(finalQuestions);
    setLoading(false);
  };

  const { speak } = useTextToSpeech();

  // Add function to handle text-to-speech for question and answer
  const handleSpeak = (question: string, answer: string) => {
    const textToSpeak = `Question: ${question}. Answer: ${answer}`;
    speak(textToSpeak);
  };

  return (
    <div className="container">
      <h1>Question Paper Answer Generator</h1>
      
      <div className="upload-section">
        <div className="upload-box">
          <h3>Upload Question Paper</h3>
          <input 
            type="file" 
            accept=".txt,.doc,.docx,.pdf"
            onChange={handleQuestionPaperUpload}
          />
          {questions.length > 0 && (
            <div className="questions-preview">
              <p>{questions.length} questions found</p>
            </div>
          )}
        </div>

        <div className="upload-box">
          <h3>Upload Study Content</h3>
          <input 
            type="file" 
            accept=".txt,.doc,.docx,.pdf"
            onChange={handleStudyContentUpload}
          />
        </div>
      </div>

      {questions.length > 0 && studyContent && (
        <div className="generate-section">
          <button 
            className="generate-btn"
            onClick={handleGenerateAnswers}
            disabled={loading}
          >
            {loading ? 'Generating...' : 'Generate Answers'}
          </button>
        </div>
      )}

      {loading && <div className="loading">Processing...</div>}

      {extractedQuestions.length > 0 && (
        <div className="results-section">
          <h2>Generated Questions and Answers</h2>
          {extractedQuestions.map((q) => (
            <div key={q.id} className="qa-item">
              <div className="question-header">
                <span className="question-text">Q{q.id}: {q.text}</span>
                <button 
                  className="volume-icon"
                  onClick={() => handleSpeak(q.text, q.answer)}
                  aria-label="Read question and answer aloud"
                >
                  🔊
                </button>
              </div>
              <div className="answer">
                <strong>Answer:</strong> {q.answer}
                {q.keywords?.length > 0 && (
                  <div className="keywords">
                    <strong>Keywords: </strong>
                    {q.keywords.join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
