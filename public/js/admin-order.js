// js/admin-order.js
import { db, collection, doc, getDocs, updateDoc, addDoc, query, orderBy } from "./common.js";

export async function createQuestion(quizId, data){
  const qRef = collection(db, "quizzes", quizId, "questions");
  const snap = await getDocs(query(qRef, orderBy("orderIndex", "desc")));
  let next = 0;
  if (!snap.empty){
    const top = snap.docs[0].data();
    next = (typeof top.orderIndex === "number" ? top.orderIndex + 1 : snap.size);
  }
  const payload = { ...data, orderIndex: next, createdAt: Date.now() };
  return await addDoc(qRef, payload);
}

export async function listQuestions(quizId){
  const qRef = collection(db, "quizzes", quizId, "questions");
  const snap = await getDocs(query(qRef, orderBy("orderIndex", "asc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function enableDragAndDrop(containerEl, quizId){
  if (!containerEl) return;
  let dragSrc = null;
  containerEl.querySelectorAll("[data-id]").forEach(el => {
    el.setAttribute("draggable", "true");
    el.addEventListener("dragstart", e => { dragSrc = el; e.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", e => e.preventDefault());
    el.addEventListener("drop", async e => {
      e.preventDefault();
      const target = e.currentTarget;
      if (!dragSrc || dragSrc === target) return;
      containerEl.insertBefore(dragSrc, target);
      await persistOrder(containerEl, quizId);
    });
  });
}

export async function persistOrder(containerEl, quizId){
  const batch = writeBatch(db);
  let idx = 0;
  containerEl.querySelectorAll("[data-id]").forEach(el => {
    const id = el.getAttribute("data-id");
    batch.update(doc(db, "quizzes", quizId, "questions", id), { orderIndex: idx++ });
  });
  await batch.commit();
  console.log("[admin-order] orderIndex persisted.");
}

export function renderQuestions(questions, containerEl){
  if (!containerEl) return;
  containerEl.innerHTML = "";
  questions.forEach(q => {
    const li = document.createElement("div");
    li.className = "questionRow";
    li.setAttribute("data-id", q.id);
    li.textContent = q.title || q.question || q.id;
    containerEl.appendChild(li);
  });
}
