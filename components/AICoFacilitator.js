import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Send, Bookmark, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import io from 'socket.io-client';
import debounce from 'lodash.debounce';

const AICoFacilitator = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [recentTranscriptions, setRecentTranscriptions] = useState([]);
  const [progress, setProgress] = useState(0);
  const [image, setImage] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(-0.8); // Default threshold

  const fileInputRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    // Connect to the '/transcription' namespace
    socketRef.current = io('/transcription'); 

    socketRef.current.on('transcriptionResult', (data) => {
      console.log('Received transcription result (raw data):', data);
      console.log('Transcription text:', data.transcription);

      const cleanedTranscription = typeof data.transcription === 'string'
        ? data.transcription.replace(/\s+/g, ' ').trim()
        : '';

      setRecentTranscriptions((prevTranscriptions) => {
        const newTranscriptions = [...prevTranscriptions, cleanedTranscription];
        return newTranscriptions.slice(-3);
      });
    });

    socketRef.current.on('transcriptionError', (error) => {
      console.error('Transcription error:', error);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.off('transcriptionResult');
        socketRef.current.off('transcriptionError');
        socketRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (isListening) {
      const intervalId = setInterval(() => {
        setProgress((prev) => Math.min(prev + 1, 100));
      }, 1000);
      return () => clearInterval(intervalId);
    }
  }, [isListening]);

  useEffect(() => {
    if (!isListening) {
      setRecentTranscriptions([]);
    }
  }, [isListening]);

  const toggleListening = async () => {
    if (!isListening) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

        let audioChunks = [];

        processorRef.current.onaudioprocess = (e) => {
          const channelData = e.inputBuffer.getChannelData(0);
          audioChunks.push(new Float32Array(channelData));

          if (audioChunks.length >= 15) {
            const audioBlob = exportWAV(audioChunks, audioContextRef.current.sampleRate);
            sendAudioChunk(audioBlob);
            audioChunks = [];
          }
        };

        source.connect(processorRef.current);
        processorRef.current.connect(audioContextRef.current.destination);

        setIsListening(true);
        setRecentTranscriptions([]);
        console.log('Started listening');
      } catch (error) {
        console.error('Error accessing microphone:', error);
      }
    } else {
      if (processorRef.current) {
        processorRef.current.disconnect();
        audioContextRef.current.close();
      }
      setIsListening(false);
      console.log('Stopped listening');
    }
  };

  const exportWAV = (audioChunks, sampleRate) => {
    const buffer = new Float32Array(audioChunks.reduce((acc, val) => acc + val.length, 0));
    let offset = 0;
    for (const chunk of audioChunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    const wav = encodeWAV(buffer, sampleRate);
    return new Blob([wav], { type: 'audio/wav' });
  };

  const encodeWAV = (samples, sampleRate) => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    const floatTo16Bit = (sample) => Math.max(-1, Math.min(1, sample)) * 0x7FFF;

    for (let i = 0; i < samples.length; i++) {
      view.setInt16(44 + i * 2, floatTo16Bit(samples[i]), true);
    }

    return buffer;
  };

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const sendAudioChunk = async (audioBlob) => {
    const arrayBuffer = await audioBlob.arrayBuffer();
    socketRef.current.emit('transcribe', {
      audio: Array.from(new Uint8Array(arrayBuffer)),
    });
  };

  const queryAI = async (question, history) => {
    try {
      const response = await fetch('http://3.144.151.147:5000/query', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: question,
          history: history
        }),
      });

      if (!response.ok) {
        throw new Error('AI query failed');
      }

      const data = await response.json();
      return data.answer;
    } catch (error) {
      console.error('Error querying AI:', error);
      return 'Sorry, I encountered an error while processing your question.';
    }
  };

  const handleSend = async () => {
    if (input.trim()) {
      const newMessage = { type: 'user', content: input };

      setMessages((prev) => [...prev, newMessage]);
      setChatHistory((prevHistory) => [...prevHistory, newMessage]);
      setInput('');

      setIsThinking(true);

      try {
        const aiResponse = await queryAI(input, chatHistory);

        setMessages((prev) => [...prev, { type: 'ai', content: aiResponse }]);
      } catch (error) {
        console.error('Error querying AI:', error);
        setMessages((prev) => [...prev, { type: 'ai', content: 'Sorry, there was an error processing your request.' }]);
      } finally {
        setIsThinking(false);
      }
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); 
      handleSend(); 
    }
  };

  const addBookmark = () => {
    setBookmarks((prev) => [...prev, { time: Date.now(), text: recentTranscriptions.join(' ') }]);
  };

  const handleFileUpload = (event) => {
    setSelectedFile(event.target.files[0]);
  };

  const handleUploadContent = async () => {
    if (!selectedFile) {
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/upload_content', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload content');
      }

      const data = await response.json();
      console.log('Content uploaded:', data);
      setSelectedFile(null);

      setUploadStatus('Content uploaded successfully!');

      setTimeout(() => {
        setUploadStatus(null);
      }, 3000);
    } catch (error) {
      console.error(error);
      setUploadStatus('Error uploading content. Please try again.');
      setTimeout(() => {
        setUploadStatus(null);
      }, 3000);
    }
  };

  const clearFileInput = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const updateProgressDebounced = useCallback(
    debounce(() => {
      setProgress((prev) => Math.min(prev + 5, 100));
    }, 1000),
    []
  );

  useEffect(() => {
    if (isListening) {
      updateProgressDebounced();
    }
  }, [isListening, recentTranscriptions]);

  const handleConfidenceChange = (event) => {
    const newThreshold = parseFloat(event.target.value);
    setConfidenceThreshold(newThreshold);

    // Emit the updated threshold to the backend
    socketRef.current.emit('updateConfidenceThreshold', newThreshold); 
  };

  return (
    <div className="max-w-3xl mx-auto mt-10 p-5 border rounded shadow">
      <h1 className="text-2xl font-bold mb-5 text-center">AI Co-Facilitator</h1>

      <div className="mb-4 p-2 border rounded bg-blue-50">
        <p>
          The AI is {isListening ? 'currently listening to' : 'not currently listening to'} the lecture and updating its knowledge base.
        </p>
      </div>

      {isListening && (
        <div className="mb-4 p-2 border rounded bg-green-50">
          <h3 className="text-lg font-semibold">Recent Transcription:</h3>
          {recentTranscriptions.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
          <button onClick={addBookmark} className="mt-2 p-2 bg-blue-500 text-white rounded">
            <Bookmark size={24} />
          </button>
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="confidenceThreshold" className="block text-sm font-medium text-gray-700">
          Confidence Threshold: {confidenceThreshold}
        </label>
        <input
          type="range"
          id="confidenceThreshold"
          min="-1"
          max="0"
          step="0.1"
          value={confidenceThreshold}
          onChange={handleConfidenceChange}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
        />
      </div>

      <div className="mb-4">
        <button
          onClick={() => setShowBookmarks(!showBookmarks)}
          className="flex items-center text-lg font-semibold"
        >
          Bookmarks:
          {showBookmarks ? <ChevronUp size={16} className="ml-2" /> : <ChevronDown size={16} className="ml-2" />}
        </button>

        {showBookmarks && (
          <ul>
            {bookmarks.map((bookmark, index) => (
              <li key={index} className="mb-2">
                <span className="font-bold">{new Date(bookmark.time).toLocaleTimeString()}</span>: {bookmark.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4 flex items-center justify-center">
        <input
          type="file"
          accept=".txt,.pdf,.docx"
          onChange={handleFileUpload}
          ref={fileInputRef}
          className="hidden"
        />
        <button 
          onClick={() => fileInputRef.current.click()}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mr-2"
        >
          Choose File
        </button>

        {selectedFile && (
          <span className="text-gray-600">
            {selectedFile.name}
          </span>
        )}

        <button 
          onClick={handleUploadContent} 
          disabled={!selectedFile}
          className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
        >
          Upload Content
        </button>
      </div>

      {uploadStatus && (
        <div className="mt-2 text-sm text-green-500 text-center">
          {uploadStatus}
        </div>
      )}

      <div className="h-64 overflow-y-auto mb-4 p-2 border rounded">
        {messages.map((message, index) => (
          <div key={index} className={`mb-2 ${message.type === 'user' ? 'text-right' : 'text-left'}`}>
            <span className={`inline-block p-2 rounded ${message.type === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>
              {message.content}
            </span>
            {index === messages.length - 1 && message.type === 'ai' && isThinking && 
              <Loader className="inline-block ml-2 animate-spin" size={16} />} 
          </div>
        ))}
      </div>

      <div className="flex items-center">
        <button
          onClick={toggleListening}
          className={`mr-2 p-2 rounded ${isListening ? 'bg-green-500' : 'bg-red-500'} text-white`}
        >
          <Mic size={24} />
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-grow mr-2 p-2 border rounded"
          placeholder="Ask a question about the lecture..."
        />
        <button onClick={handleSend} className="p-2 bg-blue-500 text-white rounded">
          <Send size={24} />
        </button>
      </div>
    </div>
  );
};

export default AICoFacilitator;