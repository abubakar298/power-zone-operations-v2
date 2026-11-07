/** Owner-approved 7 November 2026 exception: exact existing Solar jobs only.
 * Never extend this by customer, date, IPO prefix or a site-name match. */
export const historicalClosureJobKeys = new Set([
 'ubl:49','ubl:57','ubl:63','ubl:72','ubl:61','ubl:58','ubl:39','ubl:75','ubl:74','ubl:71','ubl:55',
 'ipo:5a3f8c49-3a41-42da-af53-3eb19d9fe7f1','ubl:51','ipo:041e1a68-28e0-478c-82ad-11a56776a2c2',
 'ubl:60','ubl:67','ubl:73','ubl:66','ubl:68','ubl:59','ubl:52',
]);
export const historicalClosureException=(key:string)=>historicalClosureJobKeys.has(key);
