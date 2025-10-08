// File Name: netlify/functions/ai-chat.js
// Version: 5.0 (The Ultimate Version with Long-Term Memory)

// ===== STEP 1: ZAROORI LIBRARIES KO BULANA =====
import { createClient } from '@supabase/supabase-js';
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import fs from 'fs';
import path from 'path';
// NAYI CHEEZ: Firebase se baat karne ke liye
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, limitToLast, query } from "firebase/database";

// ===== STEP 2: SIRF KHAALI DIBBAY (PLACEHOLDERS) BANANA =====
// Asli keys Netlify ki tijori se aayengi. Yahan koi secret nahin likhna.
const COHERE_API_KEY = process.env.COHERE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const AWS_ACCESS_KEY_ID = process.env.MY_AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.MY_AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.MY_AWS_REGION;

// NAYI CHEEZ: Firebase ki configuration ke liye bhi khaali dibbay
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
};

// ===== STEP 3: CONNECTIONS QAIM KARNA =====
// Yeh code check karega ke tijori mein keys mojood hain ya nahin.
let firebaseApp;
let database;
if (firebaseConfig.apiKey) {
  firebaseApp = initializeApp(firebaseConfig);
  database = getDatabase(firebaseApp);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ===== AUDIO FUNCTION (Isay nahi chherna) =====
async function generateAudio(text) {
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_REGION) {
    console.warn("AWS keys ya region nahi mila. Audio skip ho raha hai.");
    return null;
  }
  const pollyClient = new PollyClient({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });
  const params = { Text: text, OutputFormat: "mp3", VoiceId: "Kajal", Engine: "neural", LanguageCode: "en-IN" };
  try {
    const command = new SynthesizeSpeechCommand(params);
    const { AudioStream } = await pollyClient.send(command);
    const chunks = [];
    for await (const chunk of AudioStream) { chunks.push(chunk); }
    const buffer = Buffer.concat(chunks);
    const audioBase64 = buffer.toString("base64");
    console.log("✅ AWS Polly se audio generate ho gaya hai.");
    return `data:audio/mpeg;base64,${audioBase64}`;
  } catch (error) {
    console.error("❌ AWS Polly se audio generate karne mein masla:", error);
    return null;
  }
}

// ===== HAMARA MAIN FUNCTION (AI KA JISM) =====
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    let body = request.body;

    
    const { message, mode, userId } = body;

    // ===== SPECIAL MODE: DATA UPLOAD KARNE KE LIYE =====
    if (mode === 'upload_knowledge') {
      console.log('🚀 Knowledge upload mode activated...');
      const knowledgePath = path.resolve(process.cwd(), 'knowledge.json');
      const knowledgeFileContent = fs.readFileSync(knowledgePath, 'utf-8');
      const knowledgeData = JSON.parse(knowledgeFileContent);
      console.log('✅ knowledge.json file parh li gayi hai.');
      let documentsToProcess = [];
      
      // Poora data nikalne wala loop
      for (const storeName in knowledgeData) {
        if (knowledgeData[storeName] && Array.isArray(knowledgeData[storeName])) {
          knowledgeData[storeName].forEach(item => {
            if (item.keywords && item.answer) {
              documentsToProcess.push(`Sawal: ${item.keywords.join(', ')} --- Jawab: ${item.answer}`);
            }
          });
        } else if (storeName === 'ultimate_knowledge_library') {
          for (const category in knowledgeData[storeName]) {
            knowledgeData[storeName][category].forEach(q_item => {
              if (q_item.answers) {
                documentsToProcess.push(`Sawal: ${q_item.keywords.join(', ')} --- Professional Jawab: ${q_item.answers.professional} --- Kahani wala Jawab: ${q_item.answers.storyteller} --- Motivational Jawab: ${q_item.answers.motivator}`);
              }
            });
          }
        }
      }

      console.log(`📚 Total ${documentsToProcess.length} documents upload ke liye tayyar hain.`);
      for (const doc of documentsToProcess) {
        const embeddingResponse = await fetch('https://api.cohere.ai/v1/embed', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${COHERE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: [doc], model: 'embed-multilingual-v3.0', input_type: 'search_document' }),
        });
        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.embeddings[0];
        const { error } = await supabase.from('documents').insert({ content: doc, embedding: embedding });
        if (error) { console.error('❌ Supabase mein data daalne mein error:', error); }
      }
      console.log('✅ Tamam documents Supabase mein upload ho gaye hain!');
      return {
        statusCode: 200,
        body: JSON.stringify({ reply: 'Knowledge base uploaded successfully! Ab aap secret password wala code hata sakte hain.' }),
      };
    }

    // ===== NORMAL CHAT MODE =====
    if (!message || !userId) {
      return { statusCode: 400, body: 'Message and userId are required' };
    }

    // 1. Firebase se pichli chat history load karna
    const chatRef = ref(database, `ai_chats/${userId}`);
    const historyQuery = query(chatRef, limitToLast(10));
    const snapshot = await get(historyQuery);
    let chatHistory = [];
    if (snapshot.exists()) {
        snapshot.forEach(childSnapshot => {
            const msg = childSnapshot.val();
            chatHistory.push({ role: msg.role, message: msg.message });
        });
    }

    // 2. User ke naye message ko history mein save karna
    await push(chatRef, { role: 'USER', message: message, timestamp: Date.now() });

    // 3. User ke sawal ka embedding banana
    const embeddingResponse = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${COHERE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [message], model: 'embed-multilingual-v3.0', input_type: 'search_query' }),
    });
    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.embeddings[0];

    // 4. Supabase mein milte-julte jawabat dhoondna
    const { data: documents, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: 7,
    });

    if (error) {
      console.error('❌ Supabase search mein error:', error);
      throw new Error('Could not search for documents.');
    }

    const context = documents.map(doc => doc.content).join('\n\n---\n\n');

    // 5. Cohere AI ko final jawab banane ke liye kehna
    const systemPrompt = `
        You are 'Ayesha', a highly professional and expert recruitment agent for 'lifechangeeasy.io'.
        Your persona is positive, encouraging, and highly motivational. Use emojis like 😊, ✅, 🚀, ✨.
        Your primary goal is to guide the user towards joining a suitable plan, remembering all previous interactions.
        
        **Your Knowledge (Context):**
        You have been provided with the most relevant information from your knowledge base based on the user's LATEST question.
        <context>
        ${context}
        </context>

        **Your Task:**
        1. Look at the user's LATEST message.
        2. Also, CAREFULLY consider the PREVIOUS conversation history to understand the full context, user's name, their objections, and what has already been discussed.
        3. Use the provided <context> to find accurate information to answer the user's LATEST message.
        4. Formulate a personalized and motivational answer that continues the conversation naturally.
        5. ALWAYS try to bring the conversation back to the main goal: convincing the user to join the program.
        6. If the context does not contain a relevant answer, you MUST say: "Yeh ek acha sawal hai, lekin iski tafseel mere paas is waqt mojood nahin hai. Main isay note kar leti hoon aur jald hi aap ko iska jawab dungi."
    `;

    const cohereResponse = await fetch("https://api.cohere.ai/v1/chat", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${COHERE_API_KEY}` },
      body: JSON.stringify({ 
        model: "command-r-plus-08-2024", 
        preamble: systemPrompt, 
        message: message,
        chat_history: chatHistory
      }),
    });

    if (!cohereResponse.ok) {
      throw new Error(`Cohere API responded with status: ${cohereResponse.status}`);
    }

    const cohereData = await cohereResponse.json();
    const aiText = cohereData.text;

    // 6. AI ke jawab ko bhi Firebase mein save karna
    await push(chatRef, { role: 'CHATBOT', message: aiText, timestamp: Date.now() });

    // 7. Naye text se audio banana
    const audioUrl = await generateAudio(aiText);

    // 8. Final jawab user ko wapas bhejna
    response.status(200).json({ 
    reply: aiText,
    audioUrl: audioUrl 
});

  } catch (error) {
    console.error("❌ AI Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "AI agent is currently offline. Please try again later." }),
    };
  }
};
  
