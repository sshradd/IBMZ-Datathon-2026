# How the Uri Watch model works

## End-to-end pipeline

```mermaid
flowchart TB
    subgraph SRC["1 - Data sources"]
        EAGLEI["EAGLE-I outages<br/>(15-min, by county)"]
        WX["Open-Meteo weather<br/>(per county centroid)"]
        ERCOT["ERCOT grid demand<br/>(statewide, hourly)"]
        CENSUS["Census centroids<br/>+ customers per county"]
    end

    SRC --> TABLE["2 - county_hourly.csv<br/>254 TX counties x hourly<br/>pct_out, temp, wind, gust, precip, snow, demand"]
    TABLE --> PREP["3 - Preprocess<br/>target = log1p(pct_out)<br/>standardize - build 512h windows"]

    PREP --> MODEL

    subgraph MODEL["4 - Granite TinyTimeMixer (fine-tuned on IBM LinuxONE / s390x)"]
        direction TB
        PAST["Past 512 h (context)<br/>outage history + weather + demand"]
        FUT["Known-ahead 96 h<br/>weather forecast"]
        PAST --> TTM["TTM<br/>(backbone frozen, mix_channel decoder)"]
        FUT --> TTM
        TTM --> PRED["Predicted outage %<br/>next 96 h, per county"]
    end

    PRED --> HARM["5 - Harm score<br/>pred% x customers affected"]
    HARM --> DISPATCH["Greedy crew dispatch<br/>(40-crew budget)"]
    HARM --> ALERT["Alerts<br/>(at least 10% out in 24 h)"]
    PRED --> BRIEF["Briefing text<br/>(SMS / PDF)"]

    DISPATCH --> JSON["6 - JSON<br/>counties / replay / live"]
    ALERT --> JSON
    BRIEF --> JSON
    JSON --> UI["Frontend map + alerts"]
```

## Two run modes

```mermaid
flowchart LR
    subgraph BT["Backtest (validation)"]
        direction TB
        HIST["2020-2021 history<br/>(train before 2021-01-15)"] --> BTTM["TTM"]
        BTTM --> BEVAL["Evaluate on held-out<br/>Winter Storm Uri month<br/>AUC beats persistence<br/>at 6 / 24 / 96 h"]
    end

    subgraph RT["Realtime (live)"]
        direction TB
        LWX["Live Open-Meteo<br/>forecast (every 15 min)"] --> RTTM["TTM on LinuxONE"]
        RTTM --> LJSON["live.json<br/>-> live-data branch"]
        LJSON --> POLL["UI polls raw URL<br/>shows live alerts"]
    end
```

## In one sentence

The model takes **512 hours of history** (each county's recent outages, weather, and
statewide grid demand) plus the **96-hour-ahead weather forecast**, and outputs each
county's **predicted outage percentage for the next 96 hours**. Those predictions feed a
harm score, a greedy crew-dispatch allocator, and threshold alerts, which the frontend
renders on a map. The model is a fine-tuned IBM **Granite TinyTimeMixer**, trained and
served on an IBM **LinuxONE (s390x)** instance, and validated by holding out the Winter
Storm Uri month (Feb 2021), where it beats a persistence baseline on AUC at every horizon.
