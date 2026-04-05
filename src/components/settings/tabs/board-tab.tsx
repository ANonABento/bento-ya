import { CardsTab } from './cards-tab'
import { TemplatesTab } from './templates-tab'
import { ScriptsTab } from './scripts-tab'

export function BoardTab() {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M.99 5.24A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25l.01 9.5A2.25 2.25 0 0 1 16.76 17H3.26A2.267 2.267 0 0 1 1 14.74l-.01-9.5Zm8.26 9.52v-.625a.75.75 0 0 0-.75-.75H3.25a.75.75 0 0 0-.75.75v.615c0 .414.336.75.75.75h5.373a.75.75 0 0 0 .627-.74Zm1.5 0a.75.75 0 0 0 .627.74h5.373a.75.75 0 0 0 .75-.75v-.615a.75.75 0 0 0-.75-.75H11.5a.75.75 0 0 0-.75.75v.625Zm6.75-5.26v-.625a.75.75 0 0 0-.75-.75H11.5a.75.75 0 0 0-.75.75v.625c0 .414.336.75.75.75h5.25a.75.75 0 0 0 .75-.75Zm-8.5 0v-.625a.75.75 0 0 0-.75-.75H3.25a.75.75 0 0 0-.75.75v.625c0 .414.336.75.75.75H8.5a.75.75 0 0 0 .75-.75Z" clipRule="evenodd" />
          </svg>
          Card Display
        </h3>
        <CardsTab />
      </section>

      <div className="border-t border-border-default" />

      <section>
        <h3 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M6.75 2.5A.75.75 0 0 1 7.5 3v1.232l.086.014c.95.158 1.823.434 2.418.82.376.244.62.52.753.851a2 2 0 0 1-.328 2.046 3.677 3.677 0 0 1-.726.584c.253.176.478.38.662.618.623.805.626 1.793.206 2.565-.41.754-1.19 1.36-2.06 1.756a8.665 8.665 0 0 1-1.011.399V15a.75.75 0 0 1-1.5 0v-1.26a8.515 8.515 0 0 1-1.386-.455c-.905-.387-1.727-1.007-2.161-1.8-.434-.794-.407-1.833.277-2.612.213-.243.468-.457.752-.637A3.835 3.835 0 0 1 3.41 7.58a2.011 2.011 0 0 1-.24-2.13c.147-.32.397-.59.756-.826.557-.366 1.368-.637 2.268-.802L6.25 3.691V3a.75.75 0 0 1 .75-.5Z" clipRule="evenodd" />
          </svg>
          Scripts
        </h3>
        <ScriptsTab />
      </section>

      <div className="border-t border-border-default" />

      <section>
        <h3 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Zm10.857 5.691a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
          </svg>
          Templates
        </h3>
        <TemplatesTab />
      </section>
    </div>
  )
}
