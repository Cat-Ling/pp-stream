/**
 * @author Adapted from Eltik's CORS proxy
 * @description Proxies m3u8 files and their segments
 */

// Helper function to safely create a URL object
function safeCreateURL(url: string, base?: string): URL | null {
  try {
    return base ? new URL(url, base) : new URL(url);
  } catch (error) {
    console.error("URL parsing error:", error, "URL:", url, "Base:", base);
    return null;
  }
}

// Helper function to parse URLs
function parseURL(req_url: string, baseUrl?: string) {
  try {
    if (baseUrl) {
      const url = safeCreateURL(req_url, baseUrl);
      return url ? url.toString() : null;
    }
    
    // If it's already a fully qualified URL
    if (/^https?:\/\//i.test(req_url)) {
      const url = safeCreateURL(req_url);
      return url ? url.toString() : null;
    }
    
    // If it starts with // (protocol-relative URL)
    if (req_url.startsWith('//')) {
      const url = safeCreateURL(`https:${req_url}`);
      return url ? url.toString() : null;
    }
    
    // If it's a relative URL and we have a base URL
    if (baseUrl) {
      const url = safeCreateURL(req_url, baseUrl);
      return url ? url.toString() : null;
    }
    
    return null;
  } catch (error) {
    console.error("URL parsing error:", error, "for URL:", req_url, "with base:", baseUrl);
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
  
  try {
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
    
    // Validate target URL
    const validatedUrl = safeCreateURL(targetUrl);
    if (!validatedUrl) {
      return new Response(`Invalid target URL: ${targetUrl}`, { 
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    try {
      // Create base request headers
      const requestHeaders = new Headers({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...customHeaders
      });
      
      console.log("Making request to:", validatedUrl.toString());
      console.log("With headers:", JSON.stringify(Object.fromEntries(requestHeaders.entries())));
      
      // Use fetch API which is natively available in Workers
      const response = await fetch(validatedUrl.toString(), { 
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
              const regex = /URI="([^"]+)"/g;
              const match = regex.exec(line);
              const keyUrl = match ? match[1] : null;
              
              if (keyUrl) {
                let fullKeyUrl;
                try {
                  // Try to get the full URL
                  const keyUrlObj = keyUrl.startsWith('http') 
                    ? safeCreateURL(keyUrl)
                    : safeCreateURL(keyUrl, validatedUrl.toString());
                    
                  if (!keyUrlObj) {
                    throw new Error("Could not create valid URL for key");
                  }
                  
                  fullKeyUrl = keyUrlObj.toString();
                  const proxyKeyUrl = `${baseProxyUrl}/ts-proxy?url=${encodeURIComponent(fullKeyUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`;
                  newLines.push(line.replace(keyUrl, proxyKeyUrl));
                } catch (error) {
                  console.error("Error processing key URL:", keyUrl, error);
                  newLines.push(line); // Keep original if error
                }
              } else {
                newLines.push(line);
              }
            } else if (line.startsWith("#EXT-X-MEDIA:")) {
              // Proxy alternative media URLs (like audio streams)
              const regex = /URI="([^"]+)"/g;
              const match = regex.exec(line);
              const mediaUrl = match ? match[1] : null;
              
              if (mediaUrl) {
                try {
                  // Try to get the full URL
                  const mediaUrlObj = mediaUrl.startsWith('http') 
                    ? safeCreateURL(mediaUrl)
                    : safeCreateURL(mediaUrl, validatedUrl.toString());
                    
                  if (!mediaUrlObj) {
                    throw new Error("Could not create valid URL for media");
                  }
                  
                  const fullMediaUrl = mediaUrlObj.toString();
                  const proxyMediaUrl = `${baseProxyUrl}/m3u8-proxy?url=${encodeURIComponent(fullMediaUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`;
                  newLines.push(line.replace(mediaUrl, proxyMediaUrl));
                } catch (error) {
                  console.error("Error processing media URL:", mediaUrl, error);
                  newLines.push(line); // Keep original if error
                }
              } else {
                newLines.push(line);
              }
            } else {
              newLines.push(line);
            }
          } else if (line.trim()) {
            // This is a quality variant URL
            try {
              // Try to create a full URL
              const variantUrlObj = line.startsWith('http') 
                ? safeCreateURL(line)
                : safeCreateURL(line, validatedUrl.toString());
                
              if (!variantUrlObj) {
                throw new Error("Could not create valid URL for variant");
              }
              
              const variantUrl = variantUrlObj.toString();
              newLines.push(`${baseProxyUrl}/m3u8-proxy?url=${encodeURIComponent(variantUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`);
            } catch (error) {
              console.error("Error processing variant URL:", line, error);
              newLines.push(line); // Keep original if error
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
              const regex = /URI="([^"]+)"/g;
              const match = regex.exec(line);
              const keyUrl = match ? match[1] : null;
              
              if (keyUrl) {
                try {
                  // Try to get the full URL
                  const keyUrlObj = keyUrl.startsWith('http') 
                    ? safeCreateURL(keyUrl)
                    : safeCreateURL(keyUrl, validatedUrl.toString());
                    
                  if (!keyUrlObj) {
                    throw new Error("Could not create valid URL for key");
                  }
                  
                  const fullKeyUrl = keyUrlObj.toString();
                  const proxyKeyUrl = `${baseProxyUrl}/ts-proxy?url=${encodeURIComponent(fullKeyUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`;
                  newLines.push(line.replace(keyUrl, proxyKeyUrl));
                } catch (error) {
                  console.error("Error processing key URL:", keyUrl, error);
                  newLines.push(line); // Keep original if error
                }
              } else {
                newLines.push(line);
              }
            } else {
              newLines.push(line);
            }
          } else if (line.trim() && !line.startsWith("#")) {
            // This is a segment URL (.ts file)
            try {
              // Try to create a full URL
              const segmentUrlObj = line.startsWith('http') 
                ? safeCreateURL(line)
                : safeCreateURL(line, validatedUrl.toString());
                
              if (!segmentUrlObj) {
                throw new Error("Could not create valid URL for segment");
              }
              
              const segmentUrl = segmentUrlObj.toString();
              newLines.push(`${baseProxyUrl}/ts-proxy?url=${encodeURIComponent(segmentUrl)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`);
            } catch (error) {
              console.error("Error processing segment URL:", line, error);
              newLines.push(line); // Keep original if error
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
  } catch (error: any) {
    console.error('Unexpected error in m3u8-proxy:', error);
    return new Response(error.message || 'Unexpected error in m3u8-proxy', { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
} 