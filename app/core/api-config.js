export const BASE_URL =
  typeof window !== 'undefined' && window.VISION_API_BASE
    ? window.VISION_API_BASE
    : 'http://127.0.0.1:8000';

export const JETSON_BASE_URL =
  typeof window !== 'undefined' && window.VISION_JETSON_BASE
    ? window.VISION_JETSON_BASE
    : 'http://localhost:8001';
