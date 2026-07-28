"use strict";

const MAX_CHARACTERS_PER_LINE = 16;

let allWords = [];
let filteredWords = [];
let currentWordIndex = 0;
let currentWordObject = null;
let currentTheme = "";
let correctFirstAttempt = 0;
let totalAttempted = 0;
let hasAttemptedCurrent = false;
let answeredCorrectly = false;
let mode = "check";
let timerInterval = null;
let timerSeconds = 0;
let timerRunning = false;
let hasTypedInCurrentList = false;

const themeSelect = document.getElementById("theme");
const letterBoxesDiv = document.getElementById("letter-boxes");
const hiddenInput = document.getElementById("hidden-input");
const speakBtn = document.getElementById("speak-btn");
const actionBtn = document.getElementById("action-btn");
const messageDiv = document.getElementById("message");
const translationDiv = document.getElementById("translation");
const tipDiv = document.getElementById("tip");
const correctSpan = document.getElementById("correct-count");
const totalSpan = document.getElementById("total-attempts");
const accuracySpan = document.getElementById("accuracy");
const showAnswerBtn = document.getElementById("show-answer-btn");
const wordCountSpan = document.getElementById("word-count");
const timerDisplay = document.getElementById("timer-display");

init();

async function init() {
    setInteractiveState(false);

    try {
        const response = await fetch("words.json", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        allWords = validateVocabulary(data);
        populateThemes(data);
        clearWordDisplay();

        if (!allWords.length) {
            setMessage("词库中没有有效词汇。", "error");
        }
    } catch (error) {
        console.error("Error loading vocabulary:", error);
        clearWordDisplay();
        setMessage(
            "词库加载失败。请确认 words.json 与网页文件在同一目录，并通过本地服务器打开。",
            "error"
        );
    }
}

function validateVocabulary(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("words.json 的顶层必须是主题对象");
    }

    const normalized = [];

    Object.entries(data).forEach(([theme, entries]) => {
        if (!Array.isArray(entries)) {
            console.warn(`已跳过无效主题：${theme}`);
            return;
        }

        entries.forEach((item, index) => {
            if (!item || typeof item.word !== "string" || !item.word.trim()) {
                console.warn(`已跳过无效词条：${theme}[${index}]`);
                return;
            }

            const word = normalizeSpaces(item.word);
            const variants = Array.isArray(item.variants)
                ? item.variants
                : [word];

            const cleanVariants = [...new Set(
                [word, ...variants]
                    .filter(value => typeof value === "string" && value.trim())
                    .map(normalizeSpaces)
            )];

            const inferredCaseSensitive = /[A-Z]/.test(word);
            const caseSensitive = item.caseSensitive === true
                || (item.caseSensitive !== false && inferredCaseSensitive);

            normalized.push({
                word,
                translation: typeof item.translation === "string"
                    ? item.translation.trim()
                    : "",
                tip: typeof item.tip === "string" ? item.tip.trim() : "",
                theme,
                caseSensitive,
                variants: cleanVariants
            });
        });
    });

    return normalized;
}

function normalizeSpaces(value) {
    return value.trim().replace(/\s+/g, " ");
}

function populateThemes(data) {
    themeSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = "-- 选择词汇列表 --";
    themeSelect.appendChild(placeholder);

    const validThemes = Object.keys(data).filter(theme =>
        allWords.some(item => item.theme === theme)
    );

    if (validThemes.length > 1) {
        const allOption = document.createElement("option");
        allOption.value = "all";
        allOption.textContent = "全部词汇";
        themeSelect.appendChild(allOption);
    }

    validThemes.forEach(theme => {
        const option = document.createElement("option");
        option.value = theme;
        option.textContent = theme;
        themeSelect.appendChild(option);
    });
}

themeSelect.addEventListener("change", event => {
    const selectedTheme = event.target.value;
    if (!selectedTheme) {
        clearWordDisplay();
        resetStats();
        resetTimer();
        return;
    }

    filterWordsByTheme(selectedTheme);
});

letterBoxesDiv.addEventListener("click", () => {
    if (!hiddenInput.disabled) {
        hiddenInput.focus();
    }
});

speakBtn.addEventListener("click", () => {
    if (!speakBtn.disabled && currentWordObject) {
        speakWord(currentWordObject.word);
    }
});

actionBtn.addEventListener("click", () => {
    if (mode === "check") {
        checkAnswer();
    } else if (mode === "next") {
        goToNextWord();
    } else if (mode === "restart") {
        restartCurrentTheme();
    }
});

showAnswerBtn.addEventListener("click", revealAnswer);

hiddenInput.addEventListener("input", () => {
    if (!currentWordObject) return;

    let value = hiddenInput.value;
    let pattern = selectDisplayVariant(value);

    value = insertExpectedSpaces(value, pattern);

    const maximumLength = Math.max(
        ...getVariants().map(variant => variant.length),
        1
    );

    if (value.length > maximumLength) {
        value = value.slice(0, maximumLength);
    }

    if (hiddenInput.value !== value) {
        hiddenInput.value = value;
    }

    pattern = selectDisplayVariant(value);
    renderLetterBoxes(pattern, value);

    if (!hasTypedInCurrentList && value.length > 0 && filteredWords.length) {
        hasTypedInCurrentList = true;
        startTimer();
    }
});

hiddenInput.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;

    event.preventDefault();

    if (mode === "check" && !answeredCorrectly) {
        checkAnswer();
    } else if (mode === "next") {
        goToNextWord();
    } else if (mode === "restart") {
        restartCurrentTheme();
    }
});

function filterWordsByTheme(theme) {
    currentTheme = theme;
    filteredWords = theme === "all"
        ? [...allWords]
        : allWords.filter(item => item.theme === theme);

    shuffleArray(filteredWords);
    resetStats();
    resetTimer();
    currentWordIndex = 0;
    updateWordCount();

    if (filteredWords.length) {
        loadWord(0);
    } else {
        clearWordDisplay();
        setMessage("这个词库目前没有有效词汇。", "error");
    }
}

function loadWord(index) {
    currentWordObject = filteredWords[index] || null;
    if (!currentWordObject) return;

    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }

    hasAttemptedCurrent = false;
    answeredCorrectly = false;
    mode = "check";

    hiddenInput.value = "";
    hiddenInput.disabled = false;
    actionBtn.disabled = false;
    actionBtn.textContent = "Check";
    showAnswerBtn.disabled = false;
    speakBtn.disabled = false;

    translationDiv.textContent = "";
    setMessage("");
    updateTip();
    renderLetterBoxes(currentWordObject.word, "");

    hiddenInput.focus();
    speakWord(currentWordObject.word);
}

function updateTip() {
    if (!currentWordObject) {
        tipDiv.textContent = "";
        return;
    }

    const parts = [];

    if (currentWordObject.caseSensitive) {
        parts.push("⚠️ 注意：此答案区分大小写。");
    }

    if (currentWordObject.tip) {
        parts.push(`💡 Tip: ${currentWordObject.tip}`);
    }

    tipDiv.textContent = parts.join(" ");
}

function getVariants() {
    if (!currentWordObject) return [];
    return currentWordObject.variants?.length
        ? currentWordObject.variants
        : [currentWordObject.word];
}

function selectDisplayVariant(input) {
    const variants = getVariants();
    if (!variants.length) return "";

    const normalizedInput = currentWordObject.caseSensitive
        ? input
        : input.toLocaleLowerCase("en");

    const prefixMatch = variants.find(variant => {
        const candidate = currentWordObject.caseSensitive
            ? variant
            : variant.toLocaleLowerCase("en");
        return candidate.startsWith(normalizedInput);
    });

    if (prefixMatch) return prefixMatch;

    return variants.find(variant => variant.length === input.length)
        || currentWordObject.word;
}

function insertExpectedSpaces(value, pattern) {
    let formatted = value;

    for (let index = 0; index < pattern.length; index += 1) {
        if (pattern[index] !== " ") continue;
        if (formatted.length <= index) continue;

        if (formatted[index] !== " ") {
            formatted = `${formatted.slice(0, index)} ${formatted.slice(index)}`;
        }
    }

    return formatted;
}

function getDisplayRows(pattern) {
    if (!pattern.includes(" ") || pattern.length <= MAX_CHARACTERS_PER_LINE) {
        return [{ text: pattern, startIndex: 0 }];
    }

    const words = pattern.split(" ");
    const rows = [];
    let startIndex = 0;

    words.forEach(word => {
        rows.push({ text: word, startIndex });
        startIndex += word.length + 1;
    });

    return rows;
}

function renderLetterBoxes(pattern, value) {
    letterBoxesDiv.innerHTML = "";

    const rows = getDisplayRows(pattern);

    rows.forEach(({ text, startIndex }) => {
        const row = document.createElement("div");
        row.className = "word-row";

        if (text.length >= 13) {
            row.classList.add("long-row");
        }

        [...text].forEach((character, localIndex) => {
            const patternIndex = startIndex + localIndex;
            const box = document.createElement("span");
            box.className = "letter-box";

            if (character === " ") {
                box.dataset.space = "true";
                box.textContent = value[patternIndex] === " "
                    || !value[patternIndex]
                    ? "·"
                    : value[patternIndex];
            } else {
                box.textContent = value[patternIndex] || "";
            }

            row.appendChild(box);
        });

        letterBoxesDiv.appendChild(row);
    });
}

function checkAnswer() {
    if (!currentWordObject || mode !== "check" || answeredCorrectly) return;

    const userAnswer = hiddenInput.value.trim();
    const firstAttempt = !hasAttemptedCurrent;

    if (firstAttempt) {
        totalAttempted += 1;
        hasAttemptedCurrent = true;
    }

    const variants = getVariants();
    const validLengths = [...new Set(variants.map(variant => variant.length))];

    if (!validLengths.includes(userAnswer.length)) {
        const lengthText = validLengths.length === 1
            ? `${validLengths[0]} 个字符`
            : `${validLengths.join(" 或 ")} 个字符`;

        setMessage(`请完整输入 ${lengthText}`, "error");
        updateStats();
        hiddenInput.focus();
        return;
    }

    const matches = variants.some(variant =>
        currentWordObject.caseSensitive
            ? userAnswer === variant
            : userAnswer.toLocaleLowerCase("en")
                === variant.toLocaleLowerCase("en")
    );

    if (matches) {
        if (firstAttempt) {
            correctFirstAttempt += 1;
        }

        answeredCorrectly = true;
        translationDiv.textContent = currentWordObject.translation;
        setMessage("✅ 正确！", "success");

        mode = "next";
        actionBtn.textContent = currentWordIndex === filteredWords.length - 1
            ? "完成"
            : "下一个";

        hiddenInput.disabled = true;
        showAnswerBtn.disabled = true;
        actionBtn.focus();
    } else {
        setMessage("❌ 错误，再试一次", "error");
        hiddenInput.value = "";
        renderLetterBoxes(currentWordObject.word, "");
        hiddenInput.focus();
    }

    updateStats();
}

function revealAnswer() {
    if (!currentWordObject || showAnswerBtn.disabled) return;

    hiddenInput.value = currentWordObject.word;
    renderLetterBoxes(currentWordObject.word, currentWordObject.word);
    translationDiv.textContent = currentWordObject.translation;
    updateTip();
    setMessage(`答案：${getVariants().join(" / ")}`, "success");

    answeredCorrectly = true;
    mode = "next";
    hiddenInput.disabled = true;
    showAnswerBtn.disabled = true;
    actionBtn.textContent = currentWordIndex === filteredWords.length - 1
        ? "完成"
        : "下一个";
    actionBtn.focus();
}

function goToNextWord() {
    if (!filteredWords.length) return;

    if (currentWordIndex >= filteredWords.length - 1) {
        finishSession();
        return;
    }

    currentWordIndex += 1;
    loadWord(currentWordIndex);
}

function finishSession() {
    stopTimer();

    mode = "restart";
    hiddenInput.disabled = true;
    speakBtn.disabled = true;
    showAnswerBtn.disabled = true;
    actionBtn.disabled = false;
    actionBtn.textContent = "重新练习";

    setMessage(
        `🎉 本轮完成！共 ${filteredWords.length} 个词，用时 ${timerDisplay.textContent}。`,
        "success"
    );
}

function restartCurrentTheme() {
    if (!filteredWords.length || !currentTheme) return;

    shuffleArray(filteredWords);
    resetStats();
    resetTimer();
    currentWordIndex = 0;
    loadWord(0);
}

function clearWordDisplay() {
    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }

    currentWordObject = null;
    filteredWords = [];
    currentWordIndex = 0;
    currentTheme = "";
    mode = "check";

    letterBoxesDiv.innerHTML = "";
    hiddenInput.value = "";
    translationDiv.textContent = "";
    tipDiv.textContent = "";
    setMessage("");
    wordCountSpan.textContent = "0";

    setInteractiveState(false);
}

function setInteractiveState(enabled) {
    actionBtn.disabled = !enabled;
    showAnswerBtn.disabled = !enabled;
    speakBtn.disabled = !enabled;
    hiddenInput.disabled = !enabled;
}

function setMessage(text, type = "") {
    messageDiv.textContent = text;
    messageDiv.classList.remove("error", "success");

    if (type) {
        messageDiv.classList.add(type);
    }
}

function resetStats() {
    correctFirstAttempt = 0;
    totalAttempted = 0;
    updateStats();
}

function updateStats() {
    correctSpan.textContent = String(correctFirstAttempt);
    totalSpan.textContent = String(totalAttempted);

    const accuracy = totalAttempted
        ? Math.round(correctFirstAttempt / totalAttempted * 100)
        : 0;

    accuracySpan.textContent = String(accuracy);
}

function updateWordCount() {
    wordCountSpan.textContent = String(filteredWords.length);
}

function startTimer() {
    if (timerRunning) return;

    timerRunning = true;
    timerInterval = window.setInterval(() => {
        timerSeconds += 1;
        updateTimerDisplay();
    }, 1000);
}

function stopTimer() {
    if (timerInterval !== null) {
        window.clearInterval(timerInterval);
    }

    timerInterval = null;
    timerRunning = false;
}

function resetTimer() {
    stopTimer();
    timerSeconds = 0;
    hasTypedInCurrentList = false;
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const minutes = Math.floor(timerSeconds / 60);
    const seconds = timerSeconds % 60;

    timerDisplay.textContent =
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function shuffleArray(array) {
    for (let index = array.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [array[index], array[randomIndex]] =
            [array[randomIndex], array[index]];
    }

    return array;
}

function speakWord(word) {
    if (!("speechSynthesis" in window)
        || typeof SpeechSynthesisUtterance === "undefined") {
        speakBtn.disabled = true;
        speakBtn.title = "当前浏览器不支持语音朗读";
        return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.85;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(voice =>
        voice.lang.toLocaleLowerCase("en").startsWith("en-us")
    ) || voices.find(voice =>
        voice.lang.toLocaleLowerCase("en").startsWith("en")
    );

    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
}
