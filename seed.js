import { db } from './db.js';

const sample = [
  'Pokonaj minibossa',
  'Zdobądź rzadki drop',
  'Ukończ questa pobocznego',
  'Znajdź tajny skrót',
  'Wygraj pojedynek',
  'Zbierz 100 złota',
  'Ulepsz przedmiot',
  'Odwiedź nowe miasto',
  'Zrekrutuj towarzysza',
  'Wykonaj misję na czas',
  'Odkryj ukrytą lokację',
  'Użyj rzadkiej mikstury',
  'Wytrenuj umiejętność',
  'Pokonaj wroga bez obrażeń',
  'Złap rzadkiego potwora',
  'Zdobycz z rajdu',
  'Wygraj turniej',
  'Znajdź skarb',
  'Rozwiąż zagadkę',
  'Ukończ dungeon',
  'Wykonaj łańcuch zadań',
  'Wyeliminuj elitę',
  'Zaplanuj strategię',
  'Wymień się z graczem',
  'Kup legendarny item'
];

const insert = db.prepare('INSERT OR IGNORE INTO phrases (text, enabled) VALUES (?, 1)');
db.transaction(() => {
  for (const t of sample) insert.run(t);
})();

console.log('Seed completed.');

