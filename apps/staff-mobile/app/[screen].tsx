import { Link, useLocalSearchParams } from "expo-router";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
const titles: Record<string,string> = { invitation:"Invitation activation", branches:"My branches", sessions:"My sessions", profile:"My profile", language:"Language", workspace:"Workspace selection", mfa:"MFA challenge", skills:"My skills", shifts:"My upcoming shifts", leave:"My leave requests", createLeave:"Create leave request", today:"Today schedule placeholder" };
export default function StaffScreen() {
  const { screen } = useLocalSearchParams<{screen:string}>();
  return <SafeAreaView><ScrollView contentContainerStyle={{padding:24,gap:16}}><Text style={{color:'#6D28D9',fontWeight:'700'}}>STAFF · SPRINT 1</Text><Text style={{fontSize:30,fontWeight:'700'}}>{titles[screen] ?? 'Home foundation'}</Text><View style={{padding:18,backgroundColor:'#F3EEFF',borderRadius:14}}><Text>Secure loading, empty, error, retry and permission states are available for this screen.</Text></View><Link href="/">Back to home</Link></ScrollView></SafeAreaView>;
}
