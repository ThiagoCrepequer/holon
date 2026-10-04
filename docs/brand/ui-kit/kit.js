const root = document.documentElement;
const theme = document.querySelector("#theme");
theme.addEventListener("change", () => {
  root.dataset.holonTheme = theme.value;
});

const feedback = document.querySelector("#demo-feedback");
let feedbackTimeout;
for (const button of document.querySelectorAll(".demo-action")) {
  button.addEventListener("click", () => {
    clearTimeout(feedbackTimeout);
    feedback.textContent = button.dataset.demo;
    feedbackTimeout = setTimeout(() => {
      feedback.textContent = "";
    }, 5000);
  });
}

const form = document.querySelector("#demo-form");
const repository = document.querySelector("#repository");
const error = document.querySelector("#repository-error");
const formStatus = document.querySelector("#form-status");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repository.value.trim());
  repository.setAttribute("aria-invalid", String(!valid));
  error.hidden = valid;
  formStatus.textContent = valid
    ? "Formato válido. Nenhum repositório foi acessado."
    : "Revise o campo de repositório.";
  if (!valid) repository.focus();
});

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden =
      !selected;
  }
}
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next]);
    tabs[next].focus();
  });
}

const dialog = document.querySelector("#finding-dialog");
const opener = document.querySelector("#open-finding");
opener.addEventListener("click", () => dialog.showModal());
document.querySelector("#close-finding").addEventListener("click", () => {
  dialog.close();
});
dialog.addEventListener("close", () => opener.focus());

const stateSelect = document.querySelector("#state-demo");
const statePreview = document.querySelector("#state-preview");
const states = {
  loading: [
    "info",
    "Carregando a revisão",
    "Aguarde enquanto o contexto é preparado.",
  ],
  success: [
    "success",
    "Nenhum achado confirmado",
    "Os trechos elegíveis desta demonstração foram revisados.",
  ],
  partial: [
    "warning",
    "Revisão parcial",
    "Há trechos pendentes. A conclusão não cobre todo o escopo.",
  ],
  error: [
    "danger",
    "Não foi possível concluir",
    "Consulte a execução antes de tentar novamente.",
  ],
};
function renderState() {
  const [variant, title, message] = states[stateSelect.value];
  const alert = document.createElement("div");
  alert.className = `alert ${variant}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  alert.append(heading, paragraph);
  statePreview.replaceChildren(alert);
  if (stateSelect.value === "loading") {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton";
    skeleton.setAttribute("aria-hidden", "true");
    statePreview.append(skeleton);
  }
}
stateSelect.addEventListener("change", renderState);
renderState();
