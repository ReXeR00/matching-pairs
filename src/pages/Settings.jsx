// src/pages/Settings.jsx
import DataBackup from "../components/DataBackup.jsx";

function Settings() {
  return (
    <main className="board wrap">
      <section className="panel">
        <h2>Ustawienia (coming soon)</h2>
        <p className="hint">
          Tu zrobimy głośność, mute, wybór własnych dźwięków,
          eksport/import całej bazy, profil itd.
        </p>
      </section>
      <DataBackup />
    </main>
  );
}

export default Settings;
