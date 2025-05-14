/**
 * @author Adapted from Eltik's CORS proxy
 * @description Proxies TS (transport stream) files
 */

import { setResponseHeaders } from 'h3';
import https from 'node:https';
import http from 'node:http';
import { IncomingMessage } from 'http';

/**
 * Proxies TS (transport stream) files
 */
export default defineEventHandler(async (event) => {
  // Handle CORS preflight requests
  if (isPreflightRequest(event)) return handleCors(event, {});
  
  const url = getQuery(event).url as string;
  const headersParam = getQuery(event).headers as string;
  
  if (!url) {
    return sendError(event, createError({
      statusCode: 400,
      statusMessage: 'URL parameter is required'
    }));
  }
  
  let headers = {};
  try {
    headers = headersParam ? JSON.parse(headersParam) : {};
  } catch (e) {
    console.error('Error parsing headers JSON:', e, 'Raw headers:', headersParam);
    return sendError(event, createError({
      statusCode: 400,
      statusMessage: 'Invalid headers format'
    }));
  }

  console.log('Processing TS request for URL:', url);
  console.log('With headers:', JSON.stringify(headers));
  
  try {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    
    // Set appropriate headers for video content first, before starting the stream
    setResponseHeaders(event, {
      'Content-Type': 'video/mp2t',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
      'Cache-Control': 'public, max-age=3600'  // Allow caching of TS segments
    });
    
    // Create a promise that will download and stream the TS file
    return await new Promise((resolve, reject) => {
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          ...headers
        }
      };
      
      console.log('Making TS request to:', url);
      console.log('With headers:', JSON.stringify(options.headers));
      
      const requestLib = isHttps ? https : http;
      const req = requestLib.request(options, (res: IncomingMessage) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP Error: ${res.statusCode} ${res.statusMessage}`));
          return;
        }
        
        console.log('TS response status:', res.statusCode);
        
        // Create an array to collect chunks
        const chunks: Buffer[] = [];
        
        res.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        
        res.on('end', () => {
          // Combine all chunks into a single buffer
          const buffer = Buffer.concat(chunks);
          resolve(buffer);
        });
      });
      
      req.on('error', (error) => {
        console.error('TS request error:', error);
        reject(error);
      });
      
      req.end();
    });
  } catch (error: any) {
    console.error('Error proxying TS file:', error);
    return sendError(event, createError({
      statusCode: error.response?.status || 500,
      statusMessage: error.message || 'Error proxying TS file'
    }));
  }
}); 