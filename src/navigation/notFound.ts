export function notFound(): never {
  const e: any = new Error('Not Found');
  e.__SATSET_NOT_FOUND = true;
  throw e;
}

export function redirect(url: string, status = 307): never {
  const e: any = new Error('Redirect');
  e.__SATSET_REDIRECT = { url, status };
  throw e;
}
