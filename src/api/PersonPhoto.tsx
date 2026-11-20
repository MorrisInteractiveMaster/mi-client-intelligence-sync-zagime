import { useState } from "react";

export function PersonPhoto({ name, photo, alt }: { name: string; photo?: string; alt?: string }) {
  const [failed, setFailed] = useState<string>();
  return photo && failed !== photo
    ? <img className="delivery-photo" src={photo} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(photo)} />
    : <span className="delivery-photo delivery-initials" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("")}</span>;
}
