# Sherco Rit-check

Afvinklijst voor de Sherco 50 SM-R (Blackmoon '23): wat je checkt voor vertrek en na de rit, met de drie sloten en een fullscreen opwarmtimer.

Eén bestand, geen build: open `index.html`, of zet GitHub Pages aan (Settings > Pages > Deploy from branch > `main` / root).
Op je gsm: open de link en kies "Zet op beginscherm".

## Live update
De app vraagt bij elke keer openen `version.json` op. Staat daar een hoger nummer dan `APP_VERSION` in `index.html`, dan herlaadt hij zichzelf naar de nieuwe versie.
Bij een update: verhoog `APP_VERSION` in `index.html` én `v` in `version.json` naar hetzelfde nummer.
