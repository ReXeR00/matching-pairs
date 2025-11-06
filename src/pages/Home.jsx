// src/pages/Home.jsx
import { Link } from "react-router-dom";

function Home() {
  return (
    // było: <main className="board wrap">
    <main className="home-center">
      <section className="radial" aria-label="Radial Hub UI">
        <span className="radial__hub"><span className="radial__hamburger" /></span>

        <div className="radial__wrap" id="radialMenu">
          <Link className="radial__item q1" to="/game"><div className="radial__bg radial__bg--game" /></Link>
          <Link className="radial__item q2" to="/mystorage"><div className="radial__bg radial__bg--storage" /></Link>
          <Link className="radial__item q3" to="/settings"><div className="radial__bg radial__bg--settings" /></Link>
          <Link className="radial__item q4" to="/"><div className="radial__bg radial__bg--about" /></Link>
          <div className="radial__item center" aria-hidden="true"><div className="radial__bg radial__bg--center" /></div>
        </div>
      </section>
    </main>
  );
}
export default Home;
