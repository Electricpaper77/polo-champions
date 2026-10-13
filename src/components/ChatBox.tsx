import { FormEvent, useEffect, useRef, useState } from "react";
import { networkManager } from "../services/NetworkManager";

type ChatMessage = { sender:string; message:string; timestamp:number };
export function ChatBox() {
  const [messages, setMessages] = useState<ChatMessage[]>([]), [draft, setDraft] = useState("");
  const lastSend = useRef({ text: "", at: 0 });
  useEffect(() => { const off = networkManager.on("chat", message => setMessages(current => [...current, message].slice(-5))); return off; }, []);
  useEffect(() => { const timer = window.setInterval(() => setMessages(current => current.filter(message => Date.now() - message.timestamp < 5_000)), 500); return () => window.clearInterval(timer); }, []);
  const submit = (event:FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    const now = Date.now();
    if (text === lastSend.current.text && now - lastSend.current.at < 750) return;
    if (networkManager.sendChat(text)) {
      lastSend.current = { text, at: now };
      setDraft("");
    }
  };
  return <section className="chat-box" aria-label="Match chat"><div>{messages.map(message => <p key={`${message.timestamp}-${message.sender}`}><b>{message.sender}</b> {message.message}</p>)}</div><form onSubmit={submit}><input aria-label="Chat message" value={draft} maxLength={160} placeholder="Press Enter to chat" onChange={event => setDraft(event.target.value)}/></form></section>;
}
