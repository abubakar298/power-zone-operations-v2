const paths: Record<string,string> = {
  plus:'M12 5v14 M5 12h14',
  rates:'M4 3h16v18H4z M8 7h8 M8 11h2 M14 11h2 M8 15h2 M14 15h2',
  dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  site:'M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6 M9 9h1 M14 9h1',
  file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6',
  shield:'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z M8 12l3 3 5-6',
  account:'M20 21a8 8 0 0 0-16 0 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  arrow:'M5 12h14 M13 6l6 6-6 6',
  logout:'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  chevron:'M6 9l6 6 6-6',
  menu:'M3 6h18 M3 12h18 M3 18h18',
};
export function Icon({name}:{name:string}) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]??paths.file}/></svg>;
}
