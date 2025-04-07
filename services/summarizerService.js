// services/summarizerService.js
const axios = require('axios');

const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL = process.env.HF_SUMMARIZATION_MODEL || 'facebook/bart-large-cnn';
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

/**
 * Summarizes the given text using the Hugging Face Inference API.
 * @param {string} text - The text to summarize.
 * @param {object} options - Summarization parameters.
 *        options.max_length {number} - The maximum length of the summary.
 *        options.min_length {number} - The minimum length of the summary.
 * @returns {Promise<string>} - The summarized text.
 */
exports.summarizeText = async (text, options = {}) => {
  // Set default parameters if not provided.
  const { max_length = 150, min_length = 50 } = options;
  
  try {
    const response = await axios.post(
      HF_API_URL,
      {
        inputs: text,
        parameters: { max_length, min_length }
      },
      {
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // The API returns an array of result objects.
    if (Array.isArray(response.data) && response.data[0].summary_text) {
      return response.data[0].summary_text;
    }
    // Fallback: return original text if summary is not available.
    return text;
  } catch (error) {
    console.error('Error summarizing text:', error.message);
    // In case of an error, return the original text.
    return text;
  }
};
