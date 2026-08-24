export interface Station {
  frequency: number; // in MHz for FM (e.g. 98.8) or kHz for AM (e.g. 1010)
  band: 'FM' | 'AM';
  name: string;
  genre: string;
  streamUrl: string;
  tagline: string;
}

export const FM_STATIONS: Station[] = [
  {
    frequency: 88.5,
    band: 'FM',
    name: 'NPR Public Radio',
    genre: 'News & Culture',
    streamUrl: 'https://npr-ice.streamguys1.com/live.mp3',
    tagline: 'All Things Considered & World News'
  },
  {
    frequency: 92.1,
    band: 'FM',
    name: 'SomaFM Groove Salad',
    genre: 'Downtempo / Ambient',
    streamUrl: 'https://ice1.somafm.com/groovesalad-128-mp3',
    tagline: 'A nicely chilled plate of ambient beats'
  },
  {
    frequency: 96.0,
    band: 'FM',
    name: 'Jazz24 Public Radio',
    genre: 'Classic Jazz & Blues',
    streamUrl: 'https://live.wostreaming.net/manifest/knkx-jazz24aac-ibc1',
    tagline: 'The greatest jazz legends 24/7'
  },
  {
    frequency: 98.8,
    band: 'FM',
    name: 'SomaFM Secret Agent',
    genre: 'Spy / Lounge / Surf',
    streamUrl: 'https://ice2.somafm.com/secretagent-128-mp3',
    tagline: 'The soundtrack for your stylish secret mission'
  },
  {
    frequency: 100.4,
    band: 'FM',
    name: 'SomaFM Indie Pop Rocks',
    genre: 'Indie & Modern Pop',
    streamUrl: 'https://ice2.somafm.com/indiepop-128-mp3',
    tagline: 'New and classic favorite indie pop tracks'
  },
  {
    frequency: 104.2,
    band: 'FM',
    name: 'SomaFM DEF CON Radio',
    genre: 'Synthwave & Electronic',
    streamUrl: 'https://ice4.somafm.com/defcon-128-mp3',
    tagline: 'Music for hackers and cyberpunk explorers'
  },
  {
    frequency: 107.5,
    band: 'FM',
    name: 'KUSC Classical',
    genre: 'Classical & Symphony',
    streamUrl: 'https://stream.kusc.org/mp3',
    tagline: 'Timeless masterpieces and live orchestrations'
  }
];

export const AM_STATIONS: Station[] = [
  {
    frequency: 530,
    band: 'AM',
    name: 'Vintage Vinyl AM 530',
    genre: '1940s-1950s Oldies',
    streamUrl: 'https://ice6.somafm.com/seventies-128-mp3',
    tagline: 'Classic broadcasts and nostalgic melodies'
  },
  {
    frequency: 680,
    band: 'AM',
    name: 'World News Talk AM 680',
    genre: 'News & Commentary',
    streamUrl: 'https://stream.revma.ihrhls.com/zc7770',
    tagline: 'Live reports and financial updates'
  },
  {
    frequency: 880,
    band: 'AM',
    name: 'Big Band & Swing AM 880',
    genre: 'Swing & Big Band',
    streamUrl: 'https://ice2.somafm.com/illinois-128-mp3',
    tagline: 'Golden age of American radio'
  },
  {
    frequency: 1010,
    band: 'AM',
    name: 'SomaFM Drone Zone AM',
    genre: 'Atmospheric Drone',
    streamUrl: 'https://ice1.somafm.com/dronezone-128-mp3',
    tagline: 'Deep ambient soundscapes from the ether'
  },
  {
    frequency: 1420,
    band: 'AM',
    name: 'Retro Coast AM 1420',
    genre: 'Night Talk & Mysteria',
    streamUrl: 'https://ice2.somafm.com/missioncontrol-128-mp3',
    tagline: 'Deep space telemetry and midnight discussions'
  }
];

export const FM_SCALE_PRESETS = [107, 104, 100, 98, 96, 92, 88];
export const AM_SCALE_PRESETS = [1420, 1010, 880, 680, 530];
