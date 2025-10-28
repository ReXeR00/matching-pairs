// src/pages/Home.jsx
function Home() {
  return (
    <main className="board wrap">
      <section className="panel" aria-label="Home">
        <h2>Match Box by EN</h2>
        <p className="hint">
          Ucz się słówek szybciej. Twórz własne talie, graj w dopasowywanie,
          śledź wynik, baw się 🔥
        </p>

        <ul className="home-links">
          <li>
            <a className="btn" href="/game">
              ▶ Start Game
            </a>
          </li>
          <li>
            <a className="btn" href="/mystorage">
              ➕ Dodaj słowa
            </a>
          </li>
          <li>
            <a className="btn" href="/settings">
              ⚙ Ustawienia
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}

export default Home;
