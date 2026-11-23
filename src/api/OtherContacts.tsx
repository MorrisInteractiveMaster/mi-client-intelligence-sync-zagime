import { ArrowUpRight } from "lucide-react";
import { otherContacts } from "../projects/other-contacts";
import { PersonPhoto } from "./PersonPhoto";

export function OtherContacts() {
  return <section className="mi-other-contacts" aria-labelledby="mi-other-contacts-title">
    <div className="mi-section-lead"><h3 id="mi-other-contacts-title">MI Other Contacts</h3>
      <p>Public Morris Interactive contacts</p></div>
    <ul className="mi-public-contacts">
      {otherContacts.map(person => <li key={person.id}>
        <a href={person.url} target="_blank" rel="noopener noreferrer" aria-label={person.name + " · " + person.role + " (opens in a new tab)"}>
          <PersonPhoto name={person.name} photo={person.photo} alt="" />
          <div><strong>{person.name}</strong><span>{person.role}</span></div>
          <ArrowUpRight aria-hidden="true" size={18} />
        </a>
      </li>)}
    </ul>
  </section>;
}
