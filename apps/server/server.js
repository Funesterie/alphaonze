import http from 'http';
import url from 'url';

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (req.method === 'POST' && parsedUrl.pathname === '/v1/chat/completions') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const requestData = JSON.parse(body);
                // Mock response
                const response = {
                    choices: [{
                        message: {
                            content: "Bonjour ! Je suis A-11, votre assistant local."
                        }
                    }]
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(3000, '127.0.0.1', () => {
    console.log('A-11 API server listening on http://127.0.0.1:3000');
});