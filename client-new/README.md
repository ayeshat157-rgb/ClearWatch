# ClearWatch
ClearWatch is an advanced content safety and recommendation platform designed to help users navigate movies and TV shows based on their personal comfort levels. By checking for specific triggers (like jump scares, strobe lights, etc.), ClearWatch ensures a comfortable viewing experience for everyone.

## 🚀 Features
- **Personalized Safety Ratings**: Get content warnings and safety ratings tailored to your specific triggers.
- **Smart Recommendations**: AI-powered suggestions based on your preferences, viewing history, and safety requirements.
- **Real-time Trigger Scraping**: Pulls the latest trigger data from reliable sources to keep you informed before you watch.
- **Interactive Chat Assistant**: Ask questions about movie content and get safe, spoiler-free insights.
- **Watchlist Management**: Save movies you want to watch and track what you've seen.
- **Dark Mode Support**: A beautiful, modern interface designed for comfortable browsing in any lighting condition.

## 🛠️ Technology Stack
- **Frontend**: React, TypeScript, Tailwind CSS, Vite, Lucide Icons, Framer Motion
- **Backend**: Node.js, Express
- **Database**: SQLite
- **AI Integration**: Groq API for personalized recommendations and chat
- **Data Sources**: TMDb API, DoesTheDogDie API, Puppeteer for web scraping

## 📦 Installation & Setup
1. **Clone the repository**:
   ```bash
   git clone https://github.com/ayeshat157-rgb/ClearWatch.git
   cd ClearWatch
   ```

2. **Backend Setup**:
   ```bash
   cd server
   npm install
   # Create a .env file based on .env.example with your API keys (Groq, TMDb)
   npm start
   ```

3. **Frontend Setup**:
   ```bash
   cd client-new
   npm install
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173` to see the app running!

## ⚙️ Environment Variables
You will need the following API keys to run the application fully:
- `VITE_TMDB_API_KEY`: For fetching movie data and posters (Frontend)
- `GROQ_API_KEY`: For the AI recommendation engine and chat features (Backend)

## 🤝 Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the issues page.

## 📄 License
This project is licensed under the MIT License.