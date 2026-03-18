// public/app/assets/js/sja-categories.js
// Statisk liste over SJA-kategorier godkjent av Air-Tech (Lars Kristiansen, mars 2026)
// Siste element "Annet" skal utløse fritekstfelt for underkategori.

const SJA_CATEGORIES = [
  {
    id: 1,
    label: "Adkomst og arbeidssted",
    subcategories: [
      "Farlig adkomst til arbeidssted",
      "Arbeid i vanskelig tilgjengelige områder",
      "Arbeid i trange/lukkede rom"
    ]
  },
  {
    id: 2,
    label: "Arbeid i høyden",
    subcategories: [
      "Arbeid på stige, stillas eller tak",
      "Risiko for fall"
    ]
  },
  {
    id: 3,
    label: "Fallende gjenstander",
    subcategories: [
      "Arbeid hvor personer eller materiell kan bli utsatt for fallende gjenstander"
    ]
  },
  {
    id: 4,
    label: "Elektrisk arbeid",
    subcategories: [
      "Arbeid på eller nær elektriske installasjoner"
    ]
  },
  {
    id: 5,
    label: "Bruk av maskiner og verktøy",
    subcategories: [
      "Bruk av håndverktøy eller maskiner med roterende deler"
    ]
  },
  {
    id: 6,
    label: "Løft og håndtering av utstyr",
    subcategories: [
      "Manuell håndtering eller bæring av utstyr",
      "Montering av tunge komponenter"
    ]
  },
  {
    id: 7,
    label: "Ergonomiske belastninger",
    subcategories: [
      "Gående/stående arbeid over tid",
      "Ensformig arbeid eller belastende arbeidsstillinger"
    ]
  },
  {
    id: 8,
    label: "Støy og vibrasjoner",
    subcategories: [
      "Arbeid med støy eller mekanisk vibrasjon"
    ]
  },
  {
    id: 9,
    label: "Støv, gass og ventilasjon",
    subcategories: [
      "Arbeid i støvfylt miljø",
      "Eksponering for gass eller dårlig ventilasjon"
    ]
  },
  {
    id: 10,
    label: "Kjemikalier og biologiske stoffer",
    subcategories: [
      "Arbeid med kjemikalier eller andre helse-/miljøfarlige stoffer"
    ]
  },
  {
    id: 11,
    label: "Brann- og eksplosjonsfare",
    subcategories: [
      "Arbeid som kan medføre brann eller eksplosjon",
      "Varme arbeider"
    ]
  },
  {
    id: 12,
    label: "Utslipp og forurensning",
    subcategories: [
      "Risiko for utslipp til miljø (olje, diesel, kjemikalier osv.)"
    ]
  },
  {
    id: 13,
    label: "Arbeid nær trafikk eller maskiner",
    subcategories: [
      "Arbeid i områder med kjøretøy, truck eller anleggsmaskiner"
    ]
  },
  {
    id: 14,
    label: "Arbeid alene",
    subcategories: [
      "Arbeid uten andre personer i nærheten"
    ]
  },
  {
    id: 15,
    label: "Andre personer i området",
    subcategories: [
      "Arbeid i områder hvor tredjeperson kan bli utsatt for fare"
    ]
  },
  {
    id: 16,
    label: "Energifrigjøring / oppstart av utstyr",
    subcategories: [
      "Risiko for uventet oppstart av maskiner eller energitilførsel"
    ]
  },
  {
    id: 17,
    label: "Ytre forhold",
    subcategories: [
      "Arbeid utendørs",
      "Vær, kulde, varme eller glatt underlag"
    ]
  },
  {
    id: 18,
    label: "Orden og ryddighet",
    subcategories: [
      "Rot, hindringer eller dårlig orden på arbeidsstedet"
    ]
  },
  {
    id: 19,
    label: "Kompetanse og opplæring",
    subcategories: [
      "Manglende opplæring eller nødvendig sertifisering"
    ]
  },
  {
    id: 20,
    label: "Beredskap",
    subcategories: [
      "Tilgjengelig førstehjelp, slukkeutstyr og nødutganger"
    ]
  },
  {
    id: 21,
    label: "Annet",
    subcategories: [],
    freeText: true
  }
];
