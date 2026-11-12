// src/components/StorageNotice.jsx
// Informuje, gdy zapisanych słówek nie dało się w pełni odczytać.
// Dane nie są usuwane — kopia zostaje pod kluczem recoveryKey.
function StorageNotice({ state }) {
  if (!state) return null;
  const { status, skipped, recoveryKey } = state;

  let text = null;
  if (status === "unreadable") {
    text = recoveryKey
      ? `Nie udało się odczytać zapisanych słówek. Oryginalne dane zostały zachowane (kopia: ${recoveryKey}) — nic nie zostało usunięte.`
      : "Nie udało się odczytać zapisanych słówek. Oryginalne dane pozostają nienaruszone.";
  } else if (status === "partial") {
    text = `Pominięto uszkodzone wpisy (${skipped}). Pozostałe słówka są dostępne` +
      (recoveryKey ? `; pełna kopia danych: ${recoveryKey}.` : ".");
  } else if (status === "unavailable") {
    text = "Pamięć przeglądarki jest niedostępna — zmiany nie zostaną zapisane.";
  }

  if (!text) return null;
  return (
    <div className="hint" role="status">
      ⚠️ {text}
    </div>
  );
}

export default StorageNotice;
