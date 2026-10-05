// Shapes identify potentially sensitive text; they do not verify active credentials.
export const SECRET_PATTERNS = Object.freeze({
  'secret.openai': [/(?<![\w-])sk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{16,}(?![\w-])/g],
  'secret.anthropic': [/(?<![\w-])sk-ant-[A-Za-z0-9_-]{16,}(?![\w-])/g],
  'secret.aws': [
    /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|AROA|A3T[A-Z0-9])[A-Z0-9]{16}\b/g,
  ],
  'secret.github': [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  'secret.gitlab': [
    /\b(?:glpat|gldt|glrt|glptt|glft|glcbt|glagent|glimt|glsoat)-[A-Za-z0-9_-]{16,}/g,
  ],
  'secret.google': [/\bAIza[0-9A-Za-z_-]{30,}/g, /\bya29\.[0-9A-Za-z_-]{20,}/g],
  'secret.stripe': [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, /\bwhsec_[A-Za-z0-9]{16,}\b/g],
  'secret.slack': [/\bxox[baprs]-[0-9A-Za-z-]{10,}/g],
  'secret.npm': [/\bnpm_[A-Za-z0-9]{20,}\b/g],
  'secret.shopify': [/\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]{20,}\b/g],
  'secret.twilio': [/\bSK[0-9a-fA-F]{32}\b/g],
  'secret.sendgrid': [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}/g],
  'secret.huggingface': [/\bhf_[A-Za-z0-9]{20,}\b/g],
  'secret.service': [
    /\b(?:dop_v1_|doo_v1_|dor_v1_)[a-fA-F0-9]{32,}\b/g,
    /\b(?:lin_api_|lin_oauth_)[A-Za-z0-9]{20,}\b/g,
    /\bPMAK-[A-Za-z0-9-]{20,}/g,
    /\b\d{6,12}:[A-Za-z0-9_-]{30,}/g,
    /\b(?:mfa\.[A-Za-z0-9_-]{50,}|[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})/g,
    /\b(?:AccountKey|SharedAccessKey|SharedAccessSignature)[ \t]*=[ \t]*[A-Za-z0-9+/%=_-]{16,}/gi,
  ],
});

// Labels cover common structured forms and field names in English and a few other
// languages. They intentionally make no claim of general multilingual NER.
const BASE_LABEL_PATTERNS = {
  'email.labeled':
    /(?<![\p{L}\p{N}_])(?:e[ -]?mail(?:[ _-]?address)?|электронная[ \t]+почта|почта|courriel)["']?[ \t]*[:=][ \t]*["']?/giu,
  'phone.labeled':
    /(?<![\p{L}\p{N}_])(?:phone(?:[ _-]?(?:number|no\.?))?|mobile(?:[ _-]?(?:number|no\.?))?|telephone|tel\.?|cell(?:[ _-]?phone)?|fax|телефон|мобильный|téléphone|telefon|telefono)["']?[ \t]*[:=][ \t]*["']?/giu,
  'card.contextual':
    /(?<![\p{L}\p{N}_])(?:credit[ _-]?card(?:[ _-]?number)?|debit[ _-]?card(?:[ _-]?number)?|card[ _-]?(?:number|no\.?)|card|pan|cvv2?|cvc2?|(?:card[ _-]?)?pin)["']?[ \t]*[:=][ \t]*["']?/giu,
  'bank.account':
    /(?<![\p{L}\p{N}_])(?:bank[ _-]?account(?:[ _-]?(?:number|no\.?))?|account[ _-]?(?:number|no\.?)|routing(?:[ _-]?number)?|sort[ _-]?code|swift(?:[ _-]?code)?|bic|банковский[ \t]+сч[её]т|расч[её]тный[ \t]+сч[её]т|номер[ \t]+сч[её]та)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.us_ssn':
    /(?<![\p{L}\p{N}_])(?:ssn|social[ _-]?security(?:[ _-]?(?:number|no\.?))?)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.ru_passport':
    /(?<![\p{L}\p{N}_])(?:russian[ _-]?passport|паспорт(?:[ \t]+(?:рф|номер))?)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.ru_inn': /(?<![\p{L}\p{N}_])(?:inn|инн)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.ru_snils': /(?<![\p{L}\p{N}_])(?:snils|снилс)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.eu_tax':
    /(?<![\p{L}\p{N}_])(?:dni|nie|nif|codice[ _-]?fiscale|fiscal[ _-]?code|pesel|steuer[ _-]?id|steueridentifikationsnummer|bsn)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.canada_sin':
    /(?<![\p{L}\p{N}_])(?:sin|social[ _-]?insurance(?:[ _-]?number)?)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.india_aadhaar':
    /(?<![\p{L}\p{N}_])(?:aadhaar|aadhar|uidai)(?:[ _-]?(?:number|no\.?))?["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.national':
    /(?<![\p{L}\p{N}_])(?:cpf|cnpj|nric|fin|tfn|nir|nhs(?:[ _-]?number)?|tax[ _-]?file(?:[ _-]?number)?|resident[ _-]?id|hkid|curp|rfc|c[ée]dula|r[ée]gistro[ _-]?civil)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.generic':
    /(?<![\p{L}\p{N}_])(?:passport(?:[ _-]?(?:number|no\.?|id))?|national[ _-]?id(?:[ _-]?number)?|tax[ _-]?id|personal[ _-]?id|employee[ _-]?id|customer[ _-]?id|member[ _-]?id|patient[ _-]?id|medical[ _-]?record(?:[ _-]?(?:number|no\.?|id))?|driver'?s?[ _-]?licen[cs]e(?:[ _-]?(?:number|no\.?|id))?|student[ _-]?id|insurance[ _-]?(?:id|number)|birth[ _-]?certificate(?:[ _-]?number)?|document[ _-]?number|id[ _-]?number)["']?[ \t]*[:=][ \t]*["']?/giu,
  'id.birth_date':
    /(?<![\p{L}\p{N}_])(?:dob|date[ _-]?of[ _-]?birth|birth[ _-]?date|birthday|дата[ \t]+рождения)["']?[ \t]*[:=][ \t]*["']?/giu,
  'secret.assignment':
    /(?<![\p{L}\p{N}_])(?:password|passwd|pwd|passphrase|api[ _-]?key|api[ _-]?token|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|authentication[ _-]?token|client[ _-]?secret|secret[ _-]?key|private[ _-]?key|aws[ _-]?secret[ _-]?access[ _-]?key|token|secret|пароль)["']?[ \t]*[:=][ \t]*["']?/giu,
  'secret.bearer':
    /(?<![\p{L}\p{N}_])(?:authorization|proxy[ _-]?authorization|cookie|set[ _-]?cookie)["']?[ \t]*[:=][ \t]*["']?/giu,
  'person.name':
    /(?<![\p{L}\p{N}_])(?:(?:full|first|last|employee|patient|customer|contact|recipient|legal|given|family)[ _-]?name|name|имя|фио|nom|nombre)["']?[ \t]*[:=][ \t]*["']?/giu,
  'address.labeled':
    /(?<![\p{L}\p{N}_])(?:(?:home|shipping|billing|postal|residential|street|mailing|delivery)[ _-]?address|address|адрес|adresse|direcci[oó]n|anschrift)["']?[ \t]*[:=][ \t]*["']?/giu,
};

// Human-readable labels, matched literally with space/_/- spelling variants for
// structured exports. No country-specific checksum is inferred from a label.
const REGIONAL_LABELS = {
  'id.cis': [
    'ИИН',
    'ЖСН',
    'БИН',
    'РНОКПП',
    'ІПН',
    'ЄДРПОУ',
    'УНЗР',
    'IDNP',
    'IDNO',
    'cod personal',
    'FİN',
    'FIN',
    'VÖEN',
    'ПИН',
    'JSHSHIR',
    'ПИНФЛ',
    'ЖШШИР',
    'STIR',
    'УНП',
    'личный номер',
    'идентификационный номер',
    'ідэнтыфікацыйны нумар',
    'налоговый номер',
    'полис ОМС',
    'номер полиса',
    'номер паспорта',
    'пашпарт',
    'pasport',
    'անձնագիր',
    'ՀԾՀ',
    'პირადი ნომერი',
    'პასპორტი',
    'şəxsiyyət vəsiqəsi',
    'РМА',
    'РЯМ',
    'шиноснома',
    'shahsy belgisi',
    'şahsy belgisi',
    'номер удостоверения',
  ],
  'phone.labeled': [
    'номер телефона',
    'контактный телефон',
    'сотовый',
    'моб',
    'тел',
    'тэлефон',
    'телефон нөмірі',
    'байланыс телефоны',
    'нөмір',
    'телефон номери',
    'телефони мобилӣ',
    'рақами телефон',
    'telefon raqami',
    'telefon nömrəsi',
    'telefon belgisi',
    'հեռախոս',
    'ტელეფონი',
    'телефони',
    'мобільний',
    'номер телефону',
  ],
  'email.labeled': [
    'электронный адрес',
    'электронна пошта',
    'e-poçt',
    'электрондук почта',
    'elektron pochta',
    'էլեկտրոնային հասցե',
    'ელფოსტა',
  ],
  'person.name': [
    'Ф.И.О.',
    'ФИО сотрудника',
    'фамилия',
    'отчество',
    'тегі',
    'аты',
    'аты жөні',
    'аты-жөні',
    'аты жөнү',
    'аты-жөнү',
    'ПІБ',
    'прізвище',
    'ім’я',
    'імя',
    'імʼя',
    'атыя',
    'атыңыз',
    'номи насаб',
    'ФИШ',
    'ism familiya',
    'ism',
    'familiya',
    'adı soyadı',
    'ad soyad',
    'nume',
    'prenume',
    'nume complet',
    'անուն',
    'ազգանուն',
    'სახელი',
    'გვარი',
  ],
  'address.labeled': [
    'адрес проживания',
    'адрес регистрации',
    'место жительства',
    'місце проживання',
    'мекенжай',
    'тұрғылықты мекенжай',
    'дарек',
    'манзил',
    'adresa',
    'adresă',
    'ünvan',
    'yaşayış ünvanı',
    'manzil',
    'salgy',
    'հասցե',
    'მისამართი',
  ],
  'id.birth_date': [
    'дата народження',
    'туған күні',
    'туулган күнү',
    'дата нараджэння',
    'data nașterii',
    'data nasterii',
    'doğum tarixi',
    'tugilgan sana',
    'tug’ilgan sana',
    'tug‘ilgan sana',
    'таваллуд',
    'ծննդյան ամսաթիվ',
    'დაბადების თარიღი',
  ],
  'bank.account': [
    'реквизиты счета',
    'лицевой счет',
    'лицевой счёт',
    'корреспондентский счет',
    'корреспондентский счёт',
    'БИК',
    'IBAN',
    'рахунок',
    'номер рахунку',
    'есепшот',
    'банктык эсеп',
    'cont bancar',
    'hisob raqami',
  ],
  'secret.assignment': [
    'пароль доступа',
    'құпиясөз',
    'сырсөз',
    'parol',
    'şifrə',
    'գաղտնաբառ',
    'პაროლი',
    'калид',
    'токен доступа',
  ],
};
const escapeLabel = (label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regionalPatterns = Object.fromEntries(
  Object.entries(REGIONAL_LABELS).map(([id, labels]) => {
    const source = labels
      .map((label) =>
        label
          .split(/[ _-]+/)
          .map(escapeLabel)
          .join('[ _-]+'),
      )
      .join('|');
    const expression = new RegExp(
      `(?<![\\p{L}\\p{N}_])(?:${source})["']?[ \\t]*[:=][ \\t]*["']?`,
      'giu',
    );
    const base = BASE_LABEL_PATTERNS[id];
    return [id, base ? new RegExp(`(?:${base.source}|${expression.source})`, 'giu') : expression];
  }),
);
export const LABEL_PATTERNS = Object.freeze({ ...BASE_LABEL_PATTERNS, ...regionalPatterns });
