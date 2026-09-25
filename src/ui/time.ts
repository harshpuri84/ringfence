const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam', hour12: false })
const fmtS = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Amsterdam', hour12: false })

export const hhmm = (iso: string | number) => fmt.format(new Date(iso))
export const hhmmss = (iso: string | number) => fmtS.format(new Date(iso))
export const ms = (iso: string) => Date.parse(iso)
