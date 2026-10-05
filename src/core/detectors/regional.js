// Locally curated common given-name tokens, never a list of individual people.
// Names are heuristics; a known given name plus a capitalized second token can
// still describe a product or a fictional character. Labels/custom terms remain
// necessary for unknown names, surname-first records and unsupported scripts.
export const GIVEN_NAMES = Object.freeze(
  `
Adam Adrian Albert Alexander Alexandra Alfred Alice Alicia Alina Amelia Andreas
Anna Anne Anton Arthur August Barbara Beatrice Benjamin Bernhard Bettina Boris
Brigitte Bruno Carl Carla Carlos Caroline Catherine Charlotte Christian Christina
Christoph Clara Claudia Daniel Daniela David Dennis Diana Dieter Dmitri Doris
Eduard Elena Eliza Elisabeth Elizabeth Emily Emma Erik Ernst Eva Fabian Felix
Ferdinand Florian Frank Franz Franziska Friedrich Gabriel Georg George Greta
Günter Hans Harald Heinrich Helena Helmut Henrik Henry Herbert Hermann Hugo Ida
Igor Ilja Ingrid Irene Irina Isabel Isabella Ivan Jakob James Jan Jana Jasmin
Jean Jean-Pierre Jennifer Jens Jessica Joachim Johann Johannes John Jonathan
Jonas Joseph Julia Julian Julie Jürgen Karl Karla Katharina Katrin Klaus Konrad
Konstantin Lara Lars Laura Lea Lena Leon Leonie Liam Lisa Lorenz Louise Lucas
Ludwig Lukas Magdalena Manfred Manuel Marc Marcel Marco Maria Marie Marina Mario
Mark Markus Martha Martin Martina Mathias Matthias Max Maxim Michael Michaela
Mila Mira Miriam Monika Moritz Nadia Natalie Natalia Nicole Nikita Niklas Nikola
Nikolai Nina Noah Norbert Oliver Olivia Olga Oskar Otto Patrick Paul Paula Peter
Petra Philipp Rainer Ralph Raphael Rebecca Reinhard Richard Robert Roland Roman
Rosa Rose Ruth Sabrina Samuel Sandra Sarah Sebastian Sergei Silvia Simon Sofia
Sophia Stefan Stephanie Stephan Susanne Sven Tatiana Thomas Tim Tobias Ulrich
Ursula Uwe Valentin Vera Veronika Victor Victoria Viktor Vincent Walter Werner
Wilhelm Wolfgang Yulia Yusuf Yvonne Zara Zoe Zoë Zoya
Александр Александра Алексей Алёна Алена Алина Анастасия Анатолий Андрей Анна
Антон Артём Артем Артур Богдан Борис Валентина Валерий Василий Вера Виктор
Виктория Владимир Владислав Галина Георгий Григорий Даниил Дарья Денис Дмитрий
Евгений Евгения Екатерина Елена Елизавета Иван Игорь Илья Ирина Кирилл Константин
Ксения Лариса Леонид Людмила Маргарита Марина Мария Максим Михаил Надежда
Наталья Никита Николай Оксана Олег Ольга Павел Пётр Петр Полина Роман Руслан
Светлана Семён Семен Сергей София Станислав Степан Татьяна Тимур Юлия Юрий Яна
Олександр Олександра Олексій Андрій Ганна Дмитро Іван Ірина Катерина Марія
Микола Наталія Олена Петро Сергій Тетяна Юрій Аляксандр Аляксей Андрэй Ганна
Дзмітрый Мікалай Наталля Сяргей Таццяна Уладзімір
Айгүл Айгуль Айдана Айжан Айсулу Айсулуу Алия Алишер Азамат Арман Асель
Бакыт Бахтиёр Болат Данияр Дилшод Ерлан Жанна Жанар Кайрат Қайрат Марат
Нурлан Отабек Рустам Саид Салтанат Санжар Шавкат Шерзод Эльдар Эльвира
Aram Armen Anahit Ani Artur Davit Giorgi Nino Irakli Levan Mariam Tamara
Elvin Emin Ilham Leyla Nigar Aysel Aygün Murad Rashad Rauf Samir Sabina
Andrei Alexandru Ana Ion Ioana Mihai Radu Stefan Ștefan Tatiana Vasile
`
    .trim()
    .split(/\s+/),
);
const knownGiven = new Set(GIVEN_NAMES.map((name) => name.normalize('NFKC').toLowerCase()));
const nonSurnames = new Set(
  `
API Address Company Data Date Document Error Example Header Login Module Name
Office Plan Project Record Report Schedule Services Software Street Summary System
Test Update Version Straße Strasse Testfixture Synthetic Fixture
Адрес Версия Данные Документ Имя Отчёт Отчет План Пример Проект Система Тест Улица
`
    .trim()
    .toLowerCase()
    .split(/\s+/),
);
const patronymic = /(?:вич|вна|ична|ич|ұлы|қызы|уулу|кызы)$/iu;

const germanStreet =
  /(?<![\p{L}\p{N}_])(?:[\p{L}][\p{L}'’.-]{1,59}[ \t]+(?:straße|strasse|str\.|weg|allee|platz|gasse|ufer|ring)|[\p{L}][\p{L}'’.-]{1,59}(?:straße|strasse|str\.|weg|allee|platz|gasse|ufer|ring))[ \t]*\d{1,4}[a-z]?(?:[ \t]*[\/–-][ \t]*\d{1,4}[a-z]?)?(?![\p{L}\p{N}])/giu;
const cisPrefixStreet =
  /(?<![\p{L}\p{N}_])(?:ул\.?|улица|вул\.?|вулиця|проспект|пр-т|просп\.?|пер\.?|переулок|бульвар|бул\.?|кӯчаи|strada|str\.)[ \t]+[\p{L}][\p{L}'’.-]{1,49}(?:[ \t]+[\p{L}][\p{L}'’.-]{1,39}){0,2}[ \t]*,?[ \t]*(?:д(?:ом)?\.?[ \t]*)?\d{1,4}[a-zа-я]?(?:[ \t]*[\/–-][ \t]*\d{1,4}[a-zа-я]?)?(?:[ \t]*,?[ \t]*(?:корпус|корп\.?|к\.|стр\.?|строение|кв\.?|квартира|офис)[ \t]*\d{1,4}[a-zа-я]?){0,2}(?![\p{L}\p{N}])/giu;
const cisSuffixStreet =
  /(?<![\p{L}\p{N}_])[\p{L}][\p{L}'’.-]{1,49}(?:[ \t]+[\p{L}][\p{L}'’.-]{1,39}){0,1}[ \t]+(?:көшесі|көчөсү|ko['’ʻ]?chasi|küçəsi|köçesi|փողոց|ქუჩა)[ \t]+\d{1,4}[a-zа-я]?(?![\p{L}\p{N}])/giu;

export function scanRegional(text, isEnabled, add) {
  if (isEnabled('person.lexicon')) {
    for (const match of text.matchAll(
      /(?<![\p{L}\p{N}_])[\p{L}][\p{L}'’-]{1,39}(?![\p{L}\p{N}_])/gu,
    )) {
      if (!knownGiven.has(match[0].normalize('NFKC').toLowerCase())) continue;
      const firstEnd = match.index + match[0].length;
      const next = /^[ \t]+([\p{Lu}][\p{L}'’-]{1,59})(?![\p{L}\p{N}_])/u.exec(
        text.slice(firstEnd, firstEnd + 130),
      );
      if (!next || nonSurnames.has(next[1].toLowerCase())) continue;
      let end = firstEnd + next[0].length;
      const third = /^[ \t]+([\p{Lu}][\p{L}'’-]{1,59})(?![\p{L}\p{N}_])/u.exec(
        text.slice(end, end + 100),
      );
      if (
        third &&
        !nonSurnames.has(third[1].toLowerCase()) &&
        (patronymic.test(next[1]) || patronymic.test(third[1]))
      )
        end += third[0].length;
      add('person.lexicon', match.index, end);
    }
  }
  for (const [id, expressions] of [
    ['address.street_de', [germanStreet]],
    ['address.street_cis', [cisPrefixStreet, cisSuffixStreet]],
  ]) {
    if (!isEnabled(id)) continue;
    for (const expression of expressions)
      for (const match of text.matchAll(new RegExp(expression.source, expression.flags)))
        add(id, match.index, match.index + match[0].length);
  }
}
