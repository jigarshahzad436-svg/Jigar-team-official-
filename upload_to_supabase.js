// Filename: upload_to_supabase.js (FINAL - KEYS ADDED)

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { CohereClient } = require('cohere-ai');

// --- CONFIGURATION: Aapki API Keys Yahan Laga Di Gayi Hain ---
const SUPABASE_URL = 'https://lreycwmxcsqubmcsgykr.supabase.co'; 
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZXljd214Y3NxdWJtY3NneWtyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTg0Mzg3MSwiZXhwIjoyMDc1NDE5ODcxfQ.3xaDhfZCHbkyV5gmRAW4cYP7EWyKuFysz4yMjKvzx2s';
const COHERE_API_KEY = 'xlTCgAhxfEjggxj0POfeUYD9yeDp4ehCm80EsaGZ';
const KNOWLEDGE_FILE_PATH = './knowledge.json'; // <-- Make sure your data file is named knowledge.json
// ----------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const cohere = new CohereClient({ token: COHERE_API_KEY });

async function main() {
  try {
    console.log('1. knowledge.json file ko parh raha hoon...');
    const fileContent = fs.readFileSync(KNOWLEDGE_FILE_PATH, 'utf-8');
    const knowledgeData = JSON.parse(fileContent);
    console.log('   - JSON data successfully parh liya gaya hai.');

    let documentsToProcess = [];
    
    // NAYA LOGIC: JSON ke har store se data nikalne ke liye
    for (const storeName in knowledgeData) {
        const store = knowledgeData[storeName];
        if (storeName === 'onboarding_strategy') {
            documentsToProcess.push(store.platform_introduction);
            store.questions.forEach(q => documentsToProcess.push(`Sawal: ${q.query} --- Jawab: ${q.rejection_response}`));
        } else if (storeName === 'referral_engine') {
            store.leaders.forEach(l => documentsToProcess.push(l.motivation_story));
        } else if (storeName === 'vision_and_trust_engine') {
            store.pillars.forEach(p => documentsToProcess.push(p.content));
        } else if (storeName === 'plans_engine') {
            store.plans.forEach(p => documentsToProcess.push(`Plan: ${p.name} --- Tafseel: ${p.motivation_pitch}`));
        } else if (storeName === 'faq_and_objection_handler' || storeName === 'advanced_objection_handler' || storeName === 'islamic_perspective_handler') {
            for (const category in store) {
                store[category].forEach(item => {
                    if(item.answers && Array.isArray(item.answers)) {
                        documentsToProcess.push(`Sawal: ${item.keywords.join(', ')} --- Jawab: ${item.answers.join(' ')}`);
                    }
                });
            }
        } else if (storeName === 'ultimate_knowledge_library') {
            for (const category in store) {
                store[category].forEach(item => {
                    documentsToProcess.push(`Sawal: ${item.keywords.join(', ')} --- Professional Jawab: ${item.answers.professional} --- Kahani wala Jawab: ${item.answers.storyteller} --- Motivational Jawab: ${item.answers.motivator}`);
                });
            }
        } else if (storeName === 'quick_fire_questions') {
            store.forEach(item => {
                documentsToProcess.push(`Sawal: ${item.keywords.join(', ')} --- Jawab: ${item.answer}`);
            });
        }
    }

    console.log(`2. Data ko process kar ke ${documentsToProcess.length} documents banaye gaye hain.`);

    console.log('3. Har document ke liye Cohere se embeddings generate kar raha hoon... (Ismein waqt lag sakta hai)');
    const allEmbeddings = [];
    for (let i = 0; i < documentsToProcess.length; i += 96) {
        const batch = documentsToProcess.slice(i, i + 96);
        const response = await cohere.embed({
            texts: batch,
            model: "embed-multilingual-v3.0",
            inputType: "search_document",
        });
        allEmbeddings.push(...response.embeddings);
        console.log(`   - Batch ${Math.floor(i/96) + 1} complete. ${allEmbeddings.length} embeddings tayyar hain.`);
    }
    
    const documentsToInsert = documentsToProcess.map((doc, index) => ({
      content: doc,
      embedding: allEmbeddings[index],
    }));

    console.log('4. Data ko Supabase mein upload kar raha hoon...');
    const { error: deleteError } = await supabase.from('documents').delete().neq('id', 0);
    if (deleteError) throw deleteError;
    console.log('   - Purana data table se saaf kar diya gaya hai.');

    const { error: insertError } = await supabase.from('documents').insert(documentsToInsert);
    if (insertError) throw insertError;

    console.log('\n✅✅✅ MUBARAK HO! Aapka poora knowledge base Supabase mein upload ho gaya hai. ✅✅✅');

  } catch (error) {
    console.error('\n❌❌❌ PROCESS MEIN ERROR AA GAYA ❌❌❌');
    console.error('Error Details:', error.message);
  }
}

main();
