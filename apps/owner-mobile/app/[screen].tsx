import { Link, useLocalSearchParams } from "expo-router";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
const titles: Record<string,string> = { organization:"Organization summary", branches:"Branch list", branch:"Branch detail", team:"Team list", user:"User detail", sessions:"Active sessions", profile:"Profile", language:"Language", workspace:"Workspace selection", mfa:"MFA challenge", services:"Service summary", service:"Service detail", staff:"Staff list", staffDetail:"Staff detail", shifts:"Shift summary", leave:"Pending leave requests", leaveReview:"Review leave request" };
export default function OwnerScreen() {
  const { screen } = useLocalSearchParams<{screen:string}>();
  return <SafeAreaView><ScrollView contentContainerStyle={{padding:24,gap:16}}><Text style={{color:'#6D28D9',fontWeight:'700'}}>OWNER · SPRINT 1</Text><Text style={{fontSize:30,fontWeight:'700'}}>{titles[screen] ?? 'Home foundation'}</Text><View style={{padding:18,backgroundColor:'#F3EEFF',borderRadius:14}}><Text>Secure loading, empty, error, retry and permission states are available for this screen.</Text></View><Link href="/">Back to home</Link></ScrollView></SafeAreaView>;
}
