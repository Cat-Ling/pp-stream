/**
 * @author Adapted from Eltik's CORS proxy
 * @description Proxies TS (transport stream) files
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
      return new Response('URL parameter is required', { 
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    let customHeaders = {};
    try {
      customHeaders = headersParam ? JSON.parse(headersParam) : {};
    } catch (e) {
      return new Response('Invalid headers format', { 
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    // Validate the URL
    const validatedUrl = safeCreateURL(targetUrl);
    if (!validatedUrl) {
      console.error('Invalid target URL:', targetUrl);
      return new Response('Invalid target URL', { 
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    // Create request headers
    const requestHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...customHeaders
    });
    
    console.log('Fetching TS from:', validatedUrl.toString());
    console.log('With headers:', JSON.stringify(Object.fromEntries(requestHeaders.entries())));
    
    // Fetch the TS file
    const response = await fetch(validatedUrl.toString(), {
      method: 'GET',
      headers: requestHeaders
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch TS file: ${response.status} ${response.statusText}`);
    }
    
    // Get response as arrayBuffer
    const data = await response.arrayBuffer();
    
    // Return the response with appropriate headers
    return new Response(data, {
      headers: {
        'Content-Type': 'video/mp2t',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': '*',
        'Cache-Control': 'public, max-age=3600'  // Allow caching of TS segments
      }
    });
  } catch (error: any) {
    console.error('Error proxying TS file:', error);
    return new Response(error.message || 'Error proxying TS file', { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
} 