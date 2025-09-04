class PDFReader {
    constructor() {
        this.pdfText = '';
        this.paragraphs = [];
        this.sentences = [];
        this.currentSentence = 0;
        this.speechSynthesis = window.speechSynthesis;
        this.utterance = null;
        this.isPlaying = false;
        this.isEditMode = false;
        this.voices = [];
        this.selectedVoice = null;
        this.originalText = '';
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadVoices();
    }

    initializeElements() {
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('fileInput');
        this.controls = document.getElementById('controls');
        this.contentArea = document.getElementById('contentArea');
        this.textContent = document.getElementById('textContent');
        this.status = document.getElementById('status');
        this.editToolbar = document.getElementById('editToolbar');
        
        this.playBtn = document.getElementById('playBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.editBtn = document.getElementById('editBtn');
        this.saveBtn = document.getElementById('saveBtn');
        
        this.voiceSelect = document.getElementById('voiceSelect');
        this.speedSlider = document.getElementById('speedSlider');
        this.speedValue = document.getElementById('speedValue');
        this.progressFill = document.getElementById('progressFill');
        
        this.boldBtn = document.getElementById('boldBtn');
        this.italicBtn = document.getElementById('italicBtn');
        this.undoBtn = document.getElementById('undoBtn');
        this.redoBtn = document.getElementById('redoBtn');
    }

    attachEventListeners() {
        // File upload events
        this.uploadArea.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        
        // Drag and drop events
        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadArea.classList.add('dragover');
        });
        
        this.uploadArea.addEventListener('dragleave', () => {
            this.uploadArea.classList.remove('dragover');
        });
        
        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files[0]) {
                this.processPDF(files[0]);
            }
        });

        // Control events
        this.playBtn.addEventListener('click', () => this.play());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.editBtn.addEventListener('click', () => this.toggleEditMode());
        this.saveBtn.addEventListener('click', () => this.saveChanges());
        
        // Voice selection
        this.voiceSelect.addEventListener('change', (e) => {
            this.selectedVoice = this.voices.find(voice => voice.name === e.target.value);
        });
        
        // Speed control
        this.speedSlider.addEventListener('input', (e) => {
            this.speedValue.textContent = e.target.value + 'x';
            if (this.utterance) {
                this.utterance.rate = parseFloat(e.target.value);
            }
        });

        // Edit toolbar events
        this.boldBtn.addEventListener('click', () => this.formatText('bold'));
        this.italicBtn.addEventListener('click', () => this.formatText('italic'));
        this.undoBtn.addEventListener('click', () => document.execCommand('undo'));
        this.redoBtn.addEventListener('click', () => document.execCommand('redo'));

        // Voice loading event
        this.speechSynthesis.addEventListener('voiceschanged', () => this.loadVoices());
    }

    loadVoices() {
        this.voices = this.speechSynthesis.getVoices();
        
        // Filter for higher quality voices and prioritize natural-sounding ones
        const preferredVoices = this.voices.filter(voice => {
            const name = voice.name.toLowerCase();
            const lang = voice.lang.toLowerCase();
            
            // Prioritize neural/premium voices and exclude robotic ones
            return (
                lang.includes('en') && 
                !name.includes('microsoft zira') &&
                !name.includes('microsoft david') &&
                !name.includes('espeak') &&
                (name.includes('neural') || 
                 name.includes('premium') || 
                 name.includes('enhanced') ||
                 name.includes('natural') ||
                 voice.localService === false) // Often better quality
            );
        });

        // If no preferred voices, use all English voices
        const voicesToUse = preferredVoices.length > 0 ? preferredVoices : 
            this.voices.filter(voice => voice.lang.toLowerCase().includes('en'));

        // Sort by quality indicators
        voicesToUse.sort((a, b) => {
            const aScore = this.getVoiceQualityScore(a);
            const bScore = this.getVoiceQualityScore(b);
            return bScore - aScore;
        });

        this.voiceSelect.innerHTML = '';
        
        if (voicesToUse.length === 0) {
            this.voiceSelect.innerHTML = '<option value="">Default Voice</option>';
            this.selectedVoice = null;
        } else {
            voicesToUse.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.name;
                option.textContent = `${voice.name} (${voice.lang})`;
                this.voiceSelect.appendChild(option);
            });
            
            // Select the first (highest quality) voice by default
            this.selectedVoice = voicesToUse[0];
            this.voiceSelect.value = this.selectedVoice.name;
        }
    }

    getVoiceQualityScore(voice) {
        let score = 0;
        const name = voice.name.toLowerCase();
        
        // Higher scores for better quality indicators
        if (name.includes('neural')) score += 10;
        if (name.includes('premium')) score += 8;
        if (name.includes('enhanced')) score += 6;
        if (name.includes('natural')) score += 5;
        if (!voice.localService) score += 3; // Cloud voices often better
        if (name.includes('google')) score += 2;
        if (name.includes('amazon')) score += 2;
        
        // Penalize obviously robotic voices
        if (name.includes('robotic')) score -= 5;
        if (name.includes('zira')) score -= 3;
        if (name.includes('david')) score -= 3;
        
        return score;
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (file && file.type === 'application/pdf') {
            await this.processPDF(file);
        } else {
            this.showStatus('Please select a valid PDF file.', 'error');
        }
    }

    async processPDF(file) {
        this.showStatus('<div class="loading"></div>Processing PDF...', 'loading');
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            this.paragraphs = [];
            
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                
                // Group text items by their y-coordinate to identify lines and paragraphs
                const lines = this.groupTextIntoLines(textContent.items);
                const pageParagraphs = this.groupLinesIntoParagraphs(lines);
                
                this.paragraphs.push(...pageParagraphs);
            }
            
            this.pdfText = this.paragraphs.join('\n\n');
            this.originalText = this.pdfText;
            this.prepareSentences();
            this.displayContent();
            this.showControls();
            this.showStatus('PDF loaded successfully! Click Play to start reading.', 'success');
            
        } catch (error) {
            console.error('Error processing PDF:', error);
            this.showStatus('Error processing PDF. Please try another file.', 'error');
        }
    }

    groupTextIntoLines(textItems) {
        // Group text items by their y-coordinate (with some tolerance)
        const lineGroups = {};
        const tolerance = 2;

        textItems.forEach(item => {
            const y = Math.round(item.transform[5] / tolerance) * tolerance;
            if (!lineGroups[y]) {
                lineGroups[y] = [];
            }
            lineGroups[y].push(item);
        });

        // Sort each line by x-coordinate and join text
        const lines = Object.keys(lineGroups)
            .sort((a, b) => b - a) // Sort top to bottom
            .map(y => {
                const items = lineGroups[y].sort((a, b) => a.transform[4] - b.transform[4]);
                return items.map(item => item.str).join('').trim();
            })
            .filter(line => line.length > 0);

        return lines;
    }

    groupLinesIntoParagraphs(lines) {
        const paragraphs = [];
        let currentParagraph = '';

        lines.forEach((line, index) => {
            // Clean up spacing issues
            line = this.cleanText(line);
            
            if (line.length === 0) {
                // Empty line - end current paragraph if it exists
                if (currentParagraph.trim().length > 0) {
                    paragraphs.push(currentParagraph.trim());
                    currentParagraph = '';
                }
            } else {
                // Add space between lines unless the previous line ended with a hyphen
                if (currentParagraph.length > 0 && !currentParagraph.endsWith('-')) {
                    currentParagraph += ' ';
                } else if (currentParagraph.endsWith('-')) {
                    // Remove hyphen for word continuation
                    currentParagraph = currentParagraph.slice(0, -1);
                }
                
                currentParagraph += line;
            }
        });

        // Add the last paragraph if it exists
        if (currentParagraph.trim().length > 0) {
            paragraphs.push(currentParagraph.trim());
        }

        return paragraphs.filter(p => p.length > 0);
    }

    cleanText(text) {
        return text
            // Only fix obvious spacing errors, preserve most original spacing
            .replace(/\s*\n\s*/g, ' ') // Replace newlines with spaces
            .replace(/  +/g, ' ') // Multiple spaces to single space
            .trim();
    }

    prepareSentences() {
        // Create a more sophisticated sentence splitting
        this.sentences = [];
        
        this.paragraphs.forEach(paragraph => {
            const sentences = this.splitIntoSentences(paragraph);
            this.sentences.push(...sentences);
        });
    }

    splitIntoSentences(text) {
        // More sophisticated sentence splitting
        return text
            .replace(/([.!?]+)\s+/g, '$1|SPLIT|')
            .replace(/([.!?]+)$/g, '$1|SPLIT|')
            .split('|SPLIT|')
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }

    displayContent() {
        let content = '';
        let sentenceIndex = 0;
        
        this.paragraphs.forEach((paragraph, pIndex) => {
            content += `<div class="paragraph" data-paragraph="${pIndex}">`;
            
            const sentences = this.splitIntoSentences(paragraph);
            sentences.forEach(sentence => {
                if (sentence.trim()) {
                    content += `<span class="sentence" data-sentence="${sentenceIndex}">${sentence}</span> `;
                    sentenceIndex++;
                }
            });
            
            content += '</div>';
        });
        
        this.textContent.innerHTML = content;
        this.contentArea.classList.add('active');
    }

    toggleEditMode() {
        this.isEditMode = !this.isEditMode;
        
        if (this.isEditMode) {
            this.textContent.contentEditable = true;
            this.textContent.focus();
            this.editBtn.textContent = '👁️ View Mode';
            this.editBtn.classList.add('edit-mode');
            this.editToolbar.classList.add('active');
            this.saveBtn.disabled = false;
            
            // Stop any current playback
            this.stop();
            this.disablePlaybackControls();
        } else {
            this.textContent.contentEditable = false;
            this.editBtn.textContent = '✏️ Edit Mode';
            this.editBtn.classList.remove('edit-mode');
            this.editToolbar.classList.remove('active');
            this.enablePlaybackControls();
        }
    }

    saveChanges() {
        // Extract text content and rebuild sentences
        const editedText = this.textContent.innerText || this.textContent.textContent;
        this.pdfText = editedText;
        
        // Split into paragraphs and rebuild structure
        this.paragraphs = editedText.split('\n\n').filter(p => p.trim().length > 0);
        this.prepareSentences();
        this.displayContent();
        
        this.showStatus('Changes saved successfully!', 'success');
        this.saveBtn.disabled = true;
        
        // Exit edit mode
        this.toggleEditMode();
    }

    disablePlaybackControls() {
        this.playBtn.disabled = true;
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.resetBtn.disabled = true;
    }

    enablePlaybackControls() {
        this.playBtn.disabled = false;
        this.resetBtn.disabled = false;
        this.updateButtons();
    }

    formatText(command) {
        document.execCommand(command);
        this.saveBtn.disabled = false;
    }

    showControls() {
        this.controls.classList.add('active');
    }

    play() {
        if (this.sentences.length === 0 || this.isEditMode) return;
        
        if (this.speechSynthesis.paused) {
            this.speechSynthesis.resume();
            this.isPlaying = true;
            this.updateButtons();
            return;
        }
        
        this.isPlaying = true;
        this.speakCurrentSentence();
        this.updateButtons();
    }

    pause() {
        if (this.speechSynthesis.speaking) {
            this.speechSynthesis.pause();
            this.isPlaying = false;
            this.updateButtons();
        }
    }

    stop() {
        this.speechSynthesis.cancel();
        this.isPlaying = false;
        this.currentSentence = 0;
        this.clearHighlights();
        this.updateProgress();
        this.updateButtons();
    }

    reset() {
        this.stop();
        this.currentSentence = 0;
        this.clearHighlights();
        this.updateProgress();
    }

    speakCurrentSentence() {
        if (this.currentSentence >= this.sentences.length) {
            this.stop();
            this.showStatus('Reading completed!', 'success');
            return;
        }

        const sentence = this.sentences[this.currentSentence];
        this.utterance = new SpeechSynthesisUtterance(sentence);
        
        // Use selected voice if available
        if (this.selectedVoice) {
            this.utterance.voice = this.selectedVoice;
        }
        
        // Optimize speech settings for naturalness
        this.utterance.rate = parseFloat(this.speedSlider.value);
        this.utterance.pitch = 1.0; // Keep natural pitch
        this.utterance.volume = 0.9; // Slightly lower volume for comfort

        // Highlight current sentence
        this.highlightSentence(this.currentSentence);
        this.updateProgress();

        this.utterance.onend = () => {
            if (this.isPlaying) {
                this.currentSentence++;
                setTimeout(() => {
                    if (this.isPlaying) {
                        this.speakCurrentSentence();
                    }
                }, 100);
            }
        };

        this.utterance.onerror = (error) => {
            console.error('Speech synthesis error:', error);
            this.showStatus('Speech synthesis error. Please try again.', 'error');
        };

        this.speechSynthesis.speak(this.utterance);
    }

    highlightSentence(index) {
        this.clearHighlights();
        const sentenceElement = document.querySelector(`[data-sentence="${index}"]`);
        if (sentenceElement) {
            sentenceElement.classList.add('highlight');
            sentenceElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    clearHighlights() {
        const highlighted = document.querySelectorAll('.highlight');
        highlighted.forEach(el => el.classList.remove('highlight'));
    }

    updateProgress() {
        const progress = this.sentences.length > 0 ? 
            (this.currentSentence / this.sentences.length) * 100 : 0;
        this.progressFill.style.width = progress + '%';
    }

    updateButtons() {
        if (this.isEditMode) {
            this.disablePlaybackControls();
            return;
        }
        
        this.playBtn.disabled = this.isPlaying;
        this.pauseBtn.disabled = !this.isPlaying;
        this.stopBtn.disabled = !this.isPlaying && !this.speechSynthesis.paused;
    }

    showStatus(message, type = 'info') {
        this.status.innerHTML = message;
        this.status.className = 'status ' + type;
        
        if (type === 'success' || type === 'error') {
            setTimeout(() => {
                this.status.innerHTML = '';
                this.status.className = 'status';
            }, 3000);
        }
    }
}

// Initialize the PDF Reader when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Configure PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    new PDFReader();
});