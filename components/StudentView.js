import React, { useState, useEffect, useRef } from 'react';
import { Send, Bookmark, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import io from 'socket.io-client';

const StudentView = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [chatHistory, setChatHistory] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [recentTranscriptions, setRecentTranscriptions] = useState([]);
  const [showTranscription, setShowTranscription] = useState(true);

  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io('/transcription'); 

    socketRef.current.on('transcriptionResult', (data) => {
      console.log('Received transcription (student view):', data.transcription);

      const cleanedTranscription = typeof data.transcription === 'string'
        ? data.transcription.replace(/\s+/g, ' ').trim()
        : '';

      setRecentTranscriptions((prevTranscriptions) => {
        const newTranscriptions = [...prevTranscriptions, cleanedTranscription];
        return newTranscriptions.slice(-3); // Keep the last 3 lines
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

  const queryAI = async (question, history) => {
    try {
      const response = await fetch('/query', {
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
    setBookmarks((prev) => [...prev, { time: Date.now(), text: messages.filter(m => m.type === 'ai').slice(-1)[0].content }]);
  };

  return (
    <div className="max-w-3xl mx-auto mt-10 p-5 border rounded shadow">
      <h1 className="text-2xl font-bold mb-5 text-center">AI Co-Facilitator (Student View)</h1>

      {/* Transcription Section (Collapsible) */}
      <div className="mb-4">
        <button
          onClick={() => setShowTranscription(!showTranscription)}
          className="flex items-center text-lg font-semibold"
        >
          Live Transcription:
          {showTranscription ? <ChevronUp size={16} className="ml-2" /> : <ChevronDown size={16} className="ml-2" />}
        </button>

        {showTranscription && (
          <div className="mb-4 p-2 border rounded bg-green-50">
            {recentTranscriptions.map((line, index) => (
              <p key={index}>{line}</p> 
            ))}
          </div>
        )}
      </div>

      {/* Bookmarks Section (Collapsible) */}
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

export default StudentView;