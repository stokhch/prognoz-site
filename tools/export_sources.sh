#!/bin/bash
# Export the RATAN source table (view V_RAT_AR_NOAA, Oracle schema IDL) for a date range as TSV.
# Runs on the prognoz VM (FC5, Oracle XE 10g, bash 3.1). Read-only user IDL_RO.
#   ORA_RO_PASS=... bash export_sources.sh 2026-11-01 2026-11-09 > sources.tsv
# Then on any machine with Python 3:  python3 tools/sources_to_json.py sources.tsv
set -e
D1=${1:?first date YYYY-MM-DD}
D2=${2:-$D1}
: ${ORACLE_HOME:=/usr/lib/oracle/xe/app/oracle/product/10.2.0/server}
: ${ORACLE_SID:=XE}
export ORACLE_HOME ORACLE_SID PATH=$ORACLE_HOME/bin:$PATH NLS_LANG=AMERICAN_AMERICA.AL32UTF8
if [ -z "$ORA_RO_PASS" ]; then read -s -p "IDL_RO password: " ORA_RO_PASS; echo >&2; fi
echo -e "dateobs\tfname\tpos\tposy\tnoaa\tlocation\tarea\tfreq\tflux_i\tflux_v\tfreq10\tflux_i10\tflux_i2\tposykoeff\tte3\tprognoz"
sqlplus -s /nolog <<SQL | grep -v '^$'
connect idl_ro/${ORA_RO_PASS}@XE
set pagesize 0 linesize 2000 trimspool on feedback off heading off verify off tab off
select to_char(dateobs,'YYYY-MM-DD HH24:MI:SS')||chr(9)||rtrim(fname)||chr(9)||pos||chr(9)||posy||chr(9)||noaa||chr(9)||
       rtrim(location)||chr(9)||area||chr(9)||freq||chr(9)||fflux_i||chr(9)||fflux_v||chr(9)||freq10||chr(9)||fflux_i10||chr(9)||
       fflux_i2||chr(9)||posykoeff||chr(9)||te3||chr(9)||prognoz
from v_rat_ar_noaa
where dateobs >= to_date('${D1}','YYYY-MM-DD') and dateobs < to_date('${D2}','YYYY-MM-DD') + 1
order by dateobs, pos;
exit
SQL
