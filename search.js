// search.js – Login + buscador + filtros por tipo de norma
console.log("✅ search.js cargado.");

const MANIFEST_URL = "data/manifest.json";
const JSON_BASE_URL = "data/json/";

// Elementos del DOM
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("search-input");
const resultsEl = document.getElementById("results");
const loginSection = document.getElementById("login-section");
const mainLayout = document.getElementById("main-layout");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const userInfo = document.getElementById("user-info");
const filterCheckboxes = document.querySelectorAll(".filter-type");

// Usuarios de ejemplo (coinciden conceptualmente con los de Mongo en Colab)
const VALID_USERS = {
  admin: { password: "admin123", role: "admin" },
  usuario1: { password: "clave123", role: "user" },
};

// Estado de búsqueda y filtros
let lastQuery = "";
let selectedTypes = ["resolucion", "decreto", "ley", "tutela"];

// -------------------------
//  LOGIN (lado cliente)
// -------------------------

function setLoggedUser(username, role) {
  // Si luego quieres persistir la sesión, puedes volver a activar localStorage.
  // localStorage.setItem("loggedUser", JSON.stringify({ username, role }));

  if (userInfo) {
    userInfo.textContent = `Sesión iniciada como ${username} (${role})`;
  }
  if (loginSection) loginSection.classList.add("hidden");
  if (mainLayout) mainLayout.classList.remove("hidden");
}

function clearLoggedUser() {
  // localStorage.removeItem("loggedUser");
  if (userInfo) userInfo.textContent = "";
  if (loginSection) loginSection.classList.remove("hidden");
  if (mainLayout) mainLayout.classList.add("hidden");
}

function initLoginLogic() {
  // Siempre comenzamos pidiendo login
  clearLoggedUser();

  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (loginError) loginError.textContent = "";

      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;

      if (!username || !password) {
        if (loginError) loginError.textContent = "Ingresa usuario y contraseña.";
        return;
      }

      const user = VALID_USERS[username];
      if (!user || user.password !== password) {
        if (loginError) loginError.textContent = "Credenciales inválidas.";
        return;
      }

      setLoggedUser(username, user.role);
    });
  }
}

// -------------------------
//  ÍNDICE Y DOCUMENTOS
// -------------------------

if (typeof FlexSearch === "undefined") {
  console.error("❌ FlexSearch no está definido.");
  if (statusEl) {
    statusEl.textContent = "Error: no se cargó FlexSearch (revisa el script CDN).";
  }
}

const index = typeof FlexSearch !== "undefined"
  ? new FlexSearch.Document({
      document: {
        id: "_id",
        index: ["texto", "archivo", "pdf_url", "tipo"],
        store: ["_id", "archivo", "pdf_url", "texto", "tipo"],
      },
    })
  : null;

const documents = {};

// Clasificar tipo de norma según texto/archivo
function classifyType(doc) {
  const base =
    ((doc.archivo || "") + " " + (doc.texto || "")).toUpperCase();

  if (base.includes("TUTELA")) return "tutela";
  if (base.includes("DECRETO")) return "decreto";
  if (base.includes("RESOLUCIÓN") || base.includes("RESOLUCION"))
    return "resolucion";
  if (base.includes(" LEY ") || base.startsWith("LEY "))
    return "ley";
  return "otro";
}

function matchesSelectedType(doc) {
  if (!selectedTypes || selectedTypes.length === 0) return true;
  const tipo = doc.tipo || "otro";
  return selectedTypes.includes(tipo);
}

function updateSelectedTypesFromUI() {
  const active = [];
  filterCheckboxes.forEach((cb) => {
    if (cb.checked) active.push(cb.value);
  });
  selectedTypes = active;
}

// Cargar documentos
async function loadDocuments() {
  if (!statusEl) return;

  try {
    statusEl.textContent =
      "Cargando listado de documentos (manifest.json)...";
    console.log("🔎 Fetch manifest:", MANIFEST_URL);

    const res = await fetch(MANIFEST_URL);
    if (!res.ok) {
      throw new Error("No se pudo cargar manifest.json (status " + res.status + ")");
    }

    const files = await res.json();
    console.log("📄 Manifest cargado, #archivos =", files.length);
    statusEl.textContent = `Se encontraron ${files.length} archivos JSON. Cargando contenido...`;

    let count = 0;

    for (const fname of files) {
      const url = JSON_BASE_URL + fname;
      try {
        const r = await fetch(url);
        if (!r.ok) {
          console.warn("   [WARN] No se pudo cargar", fname, "status:", r.status);
          continue;
        }
        const doc = await r.json();

        const id = doc._id || fname;
        doc.tipo = classifyType(doc); // tipo de norma
        documents[id] = doc;

        if (index) {
          index.add(id, {
            _id: id,
            archivo: doc.archivo || fname,
            pdf_url: doc.pdf_url || "",
            texto: doc.texto || "",
            tipo: doc.tipo,
          });
        }

        count++;
        if (count % 10 === 0) {
          statusEl.textContent = `Cargados ${count} documentos de ${files.length}...`;
        }
      } catch (e) {
        console.warn("   [ERROR] procesando", fname, e);
      }
    }

    statusEl.textContent = `Índice cargado: ${count} documentos listos para buscar.`;
    console.log("✅ Índice finalizado. Documentos indexados:", count);
  } catch (err) {
    console.error("❌ Error en loadDocuments:", err);
    statusEl.textContent =
      "Error cargando documentos. Revisa la consola del navegador (F12).";
  }
}

// -------------------------
//  BÚSQUEDAS
// -------------------------

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function snippet(text, maxLen = 300) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

function renderResults(query) {
  resultsEl.innerHTML = "";

  const q = (query || "").trim();
  lastQuery = q;

  if (q.length < 2) {
    resultsEl.innerHTML = "<p>Escribe al menos 2 caracteres para buscar.</p>";
    return;
  }

  console.log("🔍 Buscando:", q, "con filtros:", selectedTypes);

  const hitsMap = new Map();

  // 1) FlexSearch
  if (index) {
    const resultsByField = index.search(q, { enrich: true });
    for (const fieldResult of resultsByField) {
      for (const hit of fieldResult.result) {
        const id = hit.id;
        const doc = documents[id];
        if (!doc) continue;
        if (!matchesSelectedType(doc)) continue;
        hitsMap.set(id, (hitsMap.get(id) || 0) + 1);
      }
    }
  }

  // 2) Fallback por subcadena
  if (hitsMap.size === 0) {
    console.log("ℹ️ Sin resultados del índice. Usando fallback por subcadena.");
    const qLower = q.toLowerCase();

    for (const [id, doc] of Object.entries(documents)) {
      if (!matchesSelectedType(doc)) continue;
      const texto = (doc.texto || "").toLowerCase();
      const archivo = (doc.archivo || "").toLowerCase();
      if (texto.includes(qLower) || archivo.includes(qLower)) {
        hitsMap.set(id, 1);
      }
    }
  }

  const sortedHits = Array.from(hitsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  if (sortedHits.length === 0) {
    resultsEl.innerHTML = "<p>No se encontraron resultados.</p>";
    return;
  }

  const frag = document.createDocumentFragment();

  for (const [id] of sortedHits) {
    const doc = documents[id];
    if (!doc) continue;

    const div = document.createElement("div");
    div.className = "result-item";

    const title = document.createElement("h3");
    title.textContent =
      (doc.tipo ? `[${doc.tipo.toUpperCase()}] ` : "") +
      (doc.archivo || id);

    const meta = document.createElement("p");
    meta.className = "result-meta";
    meta.innerHTML = doc.pdf_url
      ? `Fuente PDF: <a href="${escapeHtml(
          doc.pdf_url
        )}" target="_blank" rel="noopener">Abrir PDF</a>`
      : "Fuente PDF: no disponible";

    const preview = document.createElement("p");
    preview.className = "result-snippet";
    preview.textContent = snippet(doc.texto, 350);

    div.appendChild(title);
    div.appendChild(meta);
    div.appendChild(preview);
    frag.appendChild(div);
  }

  resultsEl.appendChild(frag);
}

// -------------------------
//  INICIO
// -------------------------

window.addEventListener("DOMContentLoaded", () => {
  console.log("🌐 DOMContentLoaded. Iniciando lógica...");
  initLoginLogic();
  loadDocuments();

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      renderResults(e.target.value);
    });
  }

  // Filtros: cuando cambian, actualizamos tipos y re-renderizamos
  filterCheckboxes.forEach((cb) => {
    cb.addEventListener("change", () => {
      updateSelectedTypesFromUI();
      if (lastQuery && lastQuery.length >= 2) {
        renderResults(lastQuery);
      } else {
        resultsEl.innerHTML =
          "<p>Escribe al menos 2 caracteres para buscar.</p>";
      }
    });
  });
});