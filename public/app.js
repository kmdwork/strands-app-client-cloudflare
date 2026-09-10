const loginView = document.querySelector("#login-view");
const chatView = document.querySelector("#chat-view");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const loginError = document.querySelector("#login-error");
const logoutButton = document.querySelector("#logout-button");
const userName = document.querySelector("#user-name");
const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message-input");
const imageInput = document.querySelector("#image-input");
const imagePreview = document.querySelector("#image-preview");
const imagePreviewContent = document.querySelector("#image-preview-content");
const removeImageButton = document.querySelector("#remove-image-button");
const sendButton = document.querySelector("#send-button");
const messageList = document.querySelector("#message-list");
const newChatButton = document.querySelector("#new-chat-button");
const suggestions = document.querySelectorAll(".suggestion");

let runtimeSessionId;
let sending = false;
let selectedImage;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();
  let data = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = new Error(data?.message ?? data?.error ?? "Request failed");
    error.status = response.status;
    throw error;
  }

  return data;
}

function showLogin(message = "") {
  chatView.hidden = true;
  loginView.hidden = false;
  loginError.textContent = message;
  loginError.hidden = message.length === 0;
  document.querySelector("#password").value = "";
  document.querySelector("#email").focus();
}

function showChat(session) {
  loginView.hidden = true;
  chatView.hidden = false;
  userName.textContent = session.user.name || session.user.email;
  messageInput.focus();
}

function setLoginPending(pending) {
  loginButton.disabled = pending;
  loginButton.querySelector("span").textContent = pending ? "確認中…" : "ログイン";
}

function setChatPending(pending) {
  sending = pending;
  messageInput.disabled = pending;
  sendButton.disabled = pending;
  imageInput.disabled = pending;
  removeImageButton.disabled = pending;
}

function appendInlineText(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      parent.append(strong);
    } else {
      parent.append(document.createTextNode(part));
    }
  }
}

function appendAssistantContent(parent, content) {
  const lines = content.split("\n");
  let list = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      list = null;
      continue;
    }

    if (line.startsWith("## ")) {
      list = null;
      const heading = document.createElement("h3");
      appendInlineText(heading, line.slice(3));
      parent.append(heading);
      continue;
    }

    if (line.startsWith("- ")) {
      if (list === null) {
        list = document.createElement("ul");
        parent.append(list);
      }
      const item = document.createElement("li");
      appendInlineText(item, line.slice(2));
      list.append(item);
      continue;
    }

    list = null;
    const paragraph = document.createElement("p");
    appendInlineText(paragraph, line);
    parent.append(paragraph);
  }
}

function appendMessage(role, content, images = []) {
  const article = document.createElement("article");
  article.className = `message ${role}-message`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "assistant" ? "K" : "You";

  const body = document.createElement("div");
  body.className = "message-body";

  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = role === "assistant" ? "Assistant" : "You";
  body.append(author);

  const contentElement = document.createElement("div");
  contentElement.className = "message-content";
  if (role === "assistant") {
    appendAssistantContent(contentElement, content);
  } else {
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    contentElement.append(paragraph);
  }
  body.append(contentElement);
  article.append(avatar, body);

  for (const image of images) {
    appendMessageImage(article, role, image);
  }

  messageList.append(article);
  article.scrollIntoView({ behavior: "smooth", block: "end" });
  return article;
}

function renderAssistantMessage(article, content) {
  const contentElement = article.querySelector(".message-content");
  contentElement.replaceChildren();
  appendAssistantContent(contentElement, content);
  article.scrollIntoView({ behavior: "smooth", block: "end" });
}

function appendMessageImage(article, role, image) {
  const element = document.createElement("img");
  element.className = "message-image";
  element.src = `data:${image.mediaType};base64,${image.data}`;
  element.alt = role === "assistant" ? "Assistantが生成した画像" : "添付画像";
  article.querySelector(".message-body").append(element);
}

function appendTypingIndicator() {
  const article = appendMessage("assistant", "");
  const body = article.querySelector(".message-content");
  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.setAttribute("aria-label", "回答を生成中");
  dots.append(
    document.createElement("span"),
    document.createElement("span"),
    document.createElement("span"),
  );
  body.append(dots);
  return article;
}

function resetConversation() {
  runtimeSessionId = undefined;
  messageList.replaceChildren();
  clearSelectedImage();
  appendMessage(
    "assistant",
    "新しい会話を始めます。Knowledge Baseについて質問してください。",
  );
  messageInput.focus();
}

function clearSelectedImage() {
  selectedImage = undefined;
  imageInput.value = "";
  imagePreviewContent.removeAttribute("src");
  imagePreview.hidden = true;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function resizeComposer() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 170)}px`;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  setLoginPending(true);

  const form = new FormData(loginForm);
  try {
    await requestJson("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        rememberMe: true,
      }),
    });

    const session = await requestJson("/api/auth/get-session");
    if (!session?.user) {
      throw new Error("Session was not created");
    }
    showChat(session);
  } catch {
    showLogin("メールアドレスまたはパスワードが正しくありません。");
  } finally {
    setLoginPending(false);
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await requestJson("/api/auth/sign-out", { method: "POST" });
  } finally {
    runtimeSessionId = undefined;
    logoutButton.disabled = false;
    showLogin();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending) return;

  const message = messageInput.value.trim();
  if (message.length === 0) return;

  const submittedImage = selectedImage;
  appendMessage("user", message, submittedImage === undefined ? [] : [submittedImage]);
  messageInput.value = "";
  clearSelectedImage();
  resizeComposer();
  setChatPending(true);
  const typingIndicator = appendTypingIndicator();

  try {
    const body = { message };
    if (submittedImage !== undefined) {
      body.image = submittedImage;
    }
    if (runtimeSessionId !== undefined) {
      body.sessionId = runtimeSessionId;
    }

    let assistantText = "";
    const removeTypingDots = () => {
      typingIndicator.querySelector(".typing-dots")?.remove();
    };

    await streamChat(body, {
      session(data) {
        runtimeSessionId = data.sessionId;
      },
      delta(data) {
        removeTypingDots();
        assistantText += data.text;
        renderAssistantMessage(typingIndicator, assistantText);
      },
      image(data) {
        removeTypingDots();
        appendMessageImage(typingIndicator, "assistant", data);
      },
      metadata(data) {
        typingIndicator.dataset.metadata = JSON.stringify(data);
      },
      done() {
        removeTypingDots();
      },
    });
  } catch (error) {
    const hasResponseContent =
      typingIndicator.querySelector(".message-content")?.textContent.length > 0 ||
      typingIndicator.querySelector(".message-image") !== null;
    typingIndicator.querySelector(".typing-dots")?.remove();
    if (error.status === 401) {
      typingIndicator.remove();
      showLogin("セッションの有効期限が切れました。もう一度ログインしてください。");
      return;
    }
    const errorMessage =
      "回答を取得できませんでした。少し時間をおいて、もう一度お試しください。";
    if (hasResponseContent) {
      appendMessage("assistant", errorMessage);
    } else {
      renderAssistantMessage(typingIndicator, errorMessage);
    }
  } finally {
    setChatPending(false);
    if (!chatView.hidden) messageInput.focus();
  }
});

messageInput.addEventListener("input", resizeComposer);
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

newChatButton.addEventListener("click", resetConversation);
removeImageButton.addEventListener("click", clearSelectedImage);

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (file === undefined) {
    clearSelectedImage();
    return;
  }

  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(file.type) || file.size > MAX_IMAGE_BYTES) {
    clearSelectedImage();
    appendMessage("assistant", "JPEG、PNG、WebP形式の2 MiB以下の画像を選択してください。");
    return;
  }

  try {
    const dataUrl = await readImage(file);
    const separator = dataUrl.indexOf(",");
    selectedImage = {
      mediaType: file.type,
      data: dataUrl.slice(separator + 1),
    };
    imagePreviewContent.src = dataUrl;
    imagePreview.hidden = false;
  } catch {
    clearSelectedImage();
    appendMessage("assistant", "画像を読み込めませんでした。別の画像を選択してください。");
  }
});

for (const suggestion of suggestions) {
  suggestion.addEventListener("click", () => {
    messageInput.value = suggestion.textContent;
    resizeComposer();
    chatForm.requestSubmit();
  });
}

async function initialize() {
  try {
    const session = await requestJson("/api/auth/get-session");
    if (session?.user) {
      showChat(session);
      return;
    }
    showLogin();
  } catch {
    showLogin("認証サービスへ接続できませんでした。ページを再読み込みしてください。");
  }
}

initialize();
import { streamChat } from "./chat-stream.js";
