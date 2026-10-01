// A syntactically valid response is not necessarily usable data. Reject
// incomplete source payloads instead of turning absent fields into calm weather.
export function validateWeatherDaily(data: any) {
  const daily = data?.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time.length !== 7 ||
    !daily.time.every((date: unknown) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) ||
    !daily.time.every((date: string, index: number) => Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date &&
      (index === 0 || Date.parse(date) - Date.parse(daily.time[index - 1]) === 86_400_000)) ||
    ![daily.weathercode, daily.precipitation_sum, daily.windspeed_10m_max].every(
      (values) => Array.isArray(values) && values.length === daily.time.length &&
        values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0),
    )) {
    throw new Error("Weather forecast is empty or incomplete");
  }
  return daily;
}

export function validateActiveStorms(data: any): any[] {
  if (!Array.isArray(data?.activeStorms) || !data.activeStorms.every((storm: any) =>
    storm != null && typeof storm.latitudeNumeric === "number" && Number.isFinite(storm.latitudeNumeric) &&
    Math.abs(storm.latitudeNumeric) <= 90 && typeof storm.longitudeNumeric === "number" &&
    Number.isFinite(storm.longitudeNumeric) && Math.abs(storm.longitudeNumeric) <= 180
  )) {
    throw new Error("Storm feed is incomplete or has missing coordinates");
  }
  return data.activeStorms;
}
