/**
 * @author Adapted from Eltik's CORS proxy
 * @description Proxies m3u8 files and their segments
 */

// Helper function to parse URLs
function parseURL(req_url: string, baseUrl?: string) {
  if (baseUrl) {
    return new URL(req_url, baseUrl).href;
  }
  
  const match = req_url.match(/^(?:(https?:)?\/\/)?(([^\/?]+?)(?::(\d{0,5})(?=[\/?]|$))?)([\/?][\S\s]*|$)/i);
  
  if (!match) {
    return null;
  }
  
  if (!match[1]) {
    if (/^https?:/i.test(req_url)) {
      return null;
    }
    
    // Scheme is omitted
    if (req_url.lastIndexOf("//", 0) === -1) {
      // "//" is omitted
      req_url = "//" + req_url;
    }
    req_url = (match[4] === "443" ? "https:" : "http:") + req_url;
  }
  
  try {
    const parsed = new URL(req_url);
    if (!parsed.hostname) {
      // "http://:1/" and "http:/notenoughslashes" could end up here
      return null;
    }
    return parsed.href;
  } catch (error) {
    return null;
  }
}

export default async function(request: Request, env: any, ctx: any) {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      }
    });
  }
  
  // Parse URL parameters
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  const headersParam = url.searchParams.get('headers');
  
  if (!targetUrl) {
    return new Response('URL parameter is required', { status: 400 });
  }
  
  console.log("Processing m3u8 request for URL:", targetUrl);
  
  let customHeaders = {};
  try {
    customHeaders = headersParam ? JSON.parse(headersParam) : {};
    console.log("With headers:", JSON.stringify(customHeaders));
  } catch (e) {
    return new Response('Invalid headers format', { status: 400 });
  }
  
  try {
    // Create base request headers
    const requestHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...customHeaders
    });
    
    console.log("Making request to:", targetUrl);
    console.log("With headers:", JSON.stringify(Object.fromEntries(requestHeaders.entries())));
    
    // Use fetch API which is natively available in Workers
    const response = await fetch(targetUrl, { 
      headers: requestHeaders
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch M3U8: ${response.status} ${response.statusText}`);
    }
    
    const m3u8Content = await response.text();
    
    // Get the base URL for the host
    const host = url.hostname;
    const proto = url.protocol;
    const baseProxyUrl = `${proto}//${host}`;
    
    const responseHeaders = {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    };
    
    if (m3u8Content.includes("RESOLUTION=")) {
      // This is a master playlist with multiple quality variants
      const lines = m3u8Content.split("\n");
      const newLines: string[] = [];
      
      for (const line of lines) {
        if (line.startsWith("#")) {
          if (line.startsWith("#EXT-X-KEY:")) {
            // Proxy the key URL
            const regex = /https?:\/\/[^\""\s]+/g;
            const keyUrl = regex.exec(line)?.[0];
            if (keyUrl) {
              const proxyKeyUrl = `${baseProxyUrl}/ts-proxy?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`;
              newLines.push(line.replace(keyUrl, proxyKeyUrl));
            } else {
              newLines.push(line);
            }
          } else if (line.startsWith("#EXT-X-MEDIA:")) {
            // Proxy alternative media URLs (like audio streams)
            const regex = /https?:\/\/[^\""\s]+/g;
            const mediaUrl = regex.exec(line)?.[0];
            if (mediaUrl) {
              const proxyMediaUrl = `${baseProxyUrl}/m3u8-proxy?url=${encodeURIComponent(mediaUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`;
              newLines.push(line.replace(mediaUrl, proxyMediaUrl));
            } else {
              newLines.push(line);
            }
          } else {
            newLines.push(line);
          }
        } else if (line.trim()) {
          // This is a quality variant URL
          const variantUrl = parseURL(line, targetUrl);
          if (variantUrl) {
            newLines.push(`${baseProxyUrl}/m3u8-proxy?url=${encodeURIComponent(variantUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`);
          } else {
            newLines.push(line);
          }
        } else {
          // Empty line, preserve it
          newLines.push(line);
        }
      }
      
      return new Response(newLines.join("\n"), {
        headers: responseHeaders
      });
    } else {
      // This is a media playlist with segments
      const lines = m3u8Content.split("\n");
      const newLines: string[] = [];
      
      for (const line of lines) {
        if (line.startsWith("#")) {
          if (line.startsWith("#EXT-X-KEY:")) {
            // Proxy the key URL
            const regex = /https?:\/\/[^\""\s]+/g;
            const keyUrl = regex.exec(line)?.[0];
            if (keyUrl) {
              const proxyKeyUrl = `${baseProxyUrl}/ts-proxy?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`;
              newLines.push(line.replace(keyUrl, proxyKeyUrl));
            } else {
              newLines.push(line);
            }
          } else {
            newLines.push(line);
          }
        } else if (line.trim() && !line.startsWith("#")) {
          // This is a segment URL (.ts file)
          const segmentUrl = parseURL(line, targetUrl);
          if (segmentUrl) {
            newLines.push(`${baseProxyUrl}/ts-proxy?url=${encodeURIComponent(segmentUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`);
          } else {
            newLines.push(line);
          }
        } else {
          // Comment or empty line, preserve it
          newLines.push(line);
        }
      }
      
      return new Response(newLines.join("\n"), {
        headers: responseHeaders
      });
    }
  } catch (error: any) {
    console.error('Error proxying M3U8:', error);
    return new Response(error.message || 'Error proxying M3U8 file', { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
} 