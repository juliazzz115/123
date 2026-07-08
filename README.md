# Księgowość JDG na ryczałcie

Aplikacja webowa (bez backendu, jeden plik HTML + CSS + JS) do prowadzenia księgowości jednoosobowej działalności
gospodarczej na ryczałcie od przychodów ewidencjonowanych: wystawianie faktur, ewidencja przychodów miesiąc po
miesiącu, liczenie ZUS i podatku ryczałtowego, oraz generowanie pomocniczego pliku XML do KSeF (FA(3)).

## Możliwości

- **Dane firmy** — zapisywane raz, automatycznie w przeglądarce (localStorage).
- **Okresy rozliczeniowe** — każdy miesiąc ma własną ewidencję, fazę ZUS i wynik podatku. Przychód narastająco do
  progu składki zdrowotnej liczy się automatycznie z sumy wszystkich zapisanych miesięcy danego roku.
- **Wystawianie faktur** — z pozycjami, VAT-em, walutą obcą (z przeliczeniem po kursie do PLN na potrzeby ewidencji),
  obsługą nabywców z NIP-em, zagranicznym numerem VAT-UE albo bez identyfikatora (osoba prywatna).
- **Eksport XML do KSeF** — plik roboczy wzorowany na strukturze realnego eksportu z Aplikacji Podatnika KSeF
  (poprawne nazwy pól FA(3): `P_7`/`P_8A`/`P_8B`/`P_9A`/`P_11`/`P_12`, blok `Adnotacje`, `Platnosc`, `KodUE`/`NrVatUE`,
  `JST`/`GV`). Nie zastępuje oficjalnej wysyłki — służy jako gotowy do przepisania podgląd.
- **Import XML z KSeF** — wgraj pliki wyeksportowane z KSeF, program sam rozpozna kwoty i przypisze wpis do
  właściwego miesiąca po dacie wystawienia.
- **ZUS** — ulga na start / preferencyjny ZUS / pełny ZUS, dobrowolne chorobowe, 3 progi składki zdrowotnej ryczałtu.
- **Wynik** — podatek liczony osobno dla każdej stawki ryczałtu użytej w danym miesiącu, plus podsumowanie roczne.
- **Eksport CSV** (miesięczny i roczny) i **kopia JSON** całych danych (do backupu / przeniesienia na inne urządzenie).

## Uruchomienie

Otwórz `index.html` w przeglądarce — nie są wymagane żadne zależności ani serwer.

## Czego aplikacja NIE robi

Nie wysyła faktur do KSeF (wymaga logowania przez oficjalną Aplikację Podatnika KSeF albo e-mikrofirmę) i nie składa
deklaracji PIT-28 ani ZUS DRA. Liczy kwoty i pilnuje ewidencji, żeby dane były gotowe do wpisania w tamtych systemach.
