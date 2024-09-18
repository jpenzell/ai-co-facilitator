require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const next = require('next');
const { spawn } = require('child_process');
const { io: ioClient } = require("socket.io-client");

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

const app = express();
const server = http.createServer(app);
const io = new Server(server); 

const upload = multer({ dest: 'uploads/' });

const FLASK_BACKEND_URL = 'http://3.144.151.147:5000'; // Replace with your Flask backend URL

const awsSocket = ioClient(FLASK_BACKEND_URL, {
    path: '/socket.io' 
});

awsSocket.on('connect', () => {
  console.log('Connected to AWS server');
});

awsSocket.on('disconnect', () => {
  console.log('Disconnected from AWS server');
});

awsSocket.on('error', (error) => {
  console.error('AWS Socket Error:', error);
});

nextApp.prepare().then(() => {
    app.use('/uploads', express.static('uploads'));
    app.use(express.json());

    const transcriptionNamespace = io.of('/transcription'); 

    transcriptionNamespace.on('connection', (socket) => {
        console.log('A user connected to the transcription namespace');

        socket.on('transcribe', async (data) => {
            try {
                const { audio } = data;
                const tempFilePath = path.join(__dirname, 'uploads', `temp_${Date.now()}.wav`);

                const buffer = Buffer.from(audio);
                fs.writeFileSync(tempFilePath, buffer);

                console.log('Temp file written', tempFilePath, 'Size:', fs.statSync(tempFilePath).size);

                const formData = new FormData();
                formData.append('audio', fs.createReadStream(tempFilePath));

                const response = await axios.post(`${FLASK_BACKEND_URL}/transcribe`, formData, {
                    headers: formData.getHeaders(),
                });

                console.log('Flask transcription response:', response.data);

                // Emit transcription result to the '/transcription' namespace
                transcriptionNamespace.emit('transcriptionResult', response.data); 
                console.log("Emitted transcription result to '/transcription' namespace.");

                fs.unlinkSync(tempFilePath);
            } catch (error) {
                console.error('Transcription error:', error);
                socket.emit('transcriptionError', 'Error transcribing audio');
            }
        });

        socket.on('disconnect', () => {
            console.log('A user disconnected from the transcription namespace');
        });
    });

    app.post('/upload', upload.single('audio'), (req, res) => {
        if (req.file) {
            res.json({ filename: req.file.filename });
        } else {
            res.status(400).send('No file uploaded.');
        }
    });

    app.post('/ai-query', async (req, res) => {
        try {
            const { query, context } = req.body;
            
            const response = await axios.post(`${FLASK_BACKEND_URL}/query`, {
                query,
                context
            });

            res.json(response.data);
        } catch (error) {
            console.error('Error in AI query:', error);
            res.status(500).json({ error: 'An error occurred while processing your query' });
        }
    });

    app.all('*', (req, res) => nextHandler(req, res));

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});