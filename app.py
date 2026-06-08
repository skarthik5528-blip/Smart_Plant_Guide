from flask import Flask, render_template, request, jsonify, Response
from flask_sqlalchemy import SQLAlchemy
from groq import Groq
import asyncio
import edge_tts
import io

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///plants.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

import os

client = Groq(
    api_key=os.getenv("GROQ_API_KEY", "gsk_pl0itdSJUAA100ME6uy1WGdyb3FYSMtUviuWIChgs3yfJnHLzNA")
)

# --- DATABASE MODEL ---
class Plant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    common_name = db.Column(db.String(100), nullable=False)
    biological_name = db.Column(db.String(100), nullable=False)
    sunlight = db.Column(db.Text)
    water = db.Column(db.Text)
    soil = db.Column(db.Text)
    temperature = db.Column(db.Text)
    maintenance_tips = db.Column(db.Text)
    diseases = db.Column(db.Text)
    cures = db.Column(db.Text)
    benefits = db.Column(db.Text)

with app.app_context():
    db.create_all()

def ai_response(text, language="English", history=None):
    if history is None:
        history = []
        
    prompt = f"""
You are an expert agronomist and plant disease specialist.
Please respond to the user's query about plants ENTIRELY in **{language}**.
DO NOT use English script or mix English words in your response unless they are specific biological names. 
Translate all headings (like Plant Name, Sunlight, etc.) and all advice into **{language}**.

If the user asks about a specific plant, provide a structured breakdown covering:
🌱 Plant Name (Common & Biological)
☀️ Sunlight (details + hours)
💧 Water (schedule + problems)
🌱 Soil (type + fertilizer)
🌡️ Temperature (impact)
⚠️ Disease (if any)
💊 Cure (step-by-step treatment)
💡 Farming Tips
🌍 Benefits of Cultivation
"""
    messages = [{"role": "system", "content": prompt}]
    
    for h in history:
        messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
        
    if not history:
        messages.append({"role": "user", "content": text})

    try:
        res = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages
        )
        return res.choices[0].message.content
    except Exception as e:
        return f"Error connecting to AI: {str(e)}"

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    msg = data.get("message", "")
    lang = data.get("language", "English")
    history = data.get("history", [])
    return jsonify({"reply": ai_response(msg, lang, history)})

import base64

@app.route("/upload", methods=["POST"])
def upload():
    lang = request.form.get("language", "English")
    
    if "image" not in request.files:
        return jsonify({"reply": "No image uploaded."})
        
    file = request.files["image"]
    if file.filename == "":
        return jsonify({"reply": "No image selected."})
        
    try:
        # Read and encode the image
        image_bytes = file.read()
        base64_image = base64.b64encode(image_bytes).decode("utf-8")
        
        prompt = f"""
        You are an expert plant scientist and agronomist. The user has uploaded an image of a plant. 
        Please analyze this image and provide a full report ENTIRELY in **{lang}**.
        DO NOT mix English script or words unless they are biological names.
        Identify the plant and any visible diseases or issues.
        Provide a structured response detailing:
        - 🌱 Plant Name (Common & Biological)
        - ☀️ Sunlight needs
        - 💧 Water needs
        - 🌱 Soil requirements
        - 🌡️ Temperature needs
        - ⚠️ Disease/Issue detected (if any)
        - 💊 Cure/Treatment recommendations
        - 💡 Farming Tips
        Format it beautifully with emojis.
        """
        
        res = client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{file.content_type};base64,{base64_image}",
                            },
                        },
                    ],
                }
            ],
            temperature=0.5,
        )
        return jsonify({"reply": res.choices[0].message.content})
    except Exception as e:
        return jsonify({"reply": f"Error analyzing image with AI: {str(e)}"})

@app.route("/plant-info", methods=["GET"])
def plant_info():
    # Endpoint to search the 5000 plant DB
    query = request.args.get("q", "").lower()
    if not query:
        return jsonify({"error": "No search query provided"}), 400
    
    plant = Plant.query.filter(Plant.common_name.ilike(f"%{query}%")).first()
    if plant:
        return jsonify({
            "common_name": plant.common_name,
            "biological_name": plant.biological_name,
            "sunlight": plant.sunlight,
            "water": plant.water,
            "soil": plant.soil,
            "temperature": plant.temperature,
            "tips": plant.maintenance_tips,
            "diseases": plant.diseases,
            "cures": plant.cures,
            "benefits": plant.benefits
        })
    else:
        return jsonify({"error": "Plant not found in database."}), 404

@app.route("/speak")
def speak():
    text = request.args.get("text", "")
    lang = request.args.get("lang", "English")
    
    # Map languages to high-quality edge-tts voices
    voice_map = {
        "English": "en-US-GuyNeural",
        "Kannada": "kn-IN-GaganNeural",
        "Hindi": "hi-IN-MadhurNeural",
        "Tamil": "ta-IN-ValluvarNeural",
        "Telugu": "te-IN-MohanNeural"
    }
    voice = voice_map.get(lang, "en-US-GuyNeural")
    
    async def generate_speech():
        communicate = edge_tts.Communicate(text, voice)
        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]
        return audio_data

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        audio_bytes = loop.run_until_complete(generate_speech())
        loop.close()
        return Response(audio_bytes, mimetype="audio/mpeg")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file"}), 400
    
    audio_file = request.files["audio"]
    
    try:
        # Use Groq's Whisper model for high-accuracy transcription
        transcription = client.audio.transcriptions.create(
            file=("speech.webm", audio_file.read()),
            model="whisper-large-v3",
        )
        return jsonify({"transcript": transcription.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)
